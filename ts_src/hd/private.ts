import {
  bytesToHex as toHex,
  hexToBytes as fromHex,
} from "@noble/hashes/utils";
import { ZERO_KEY, ZERO_PRIVKEY } from "./common";
import {
  Keyring,
  PrivateKeyOptions,
  SerializedHDKey,
  Hex,
  ToSignInput,
} from "./types";
import { BaseWallet } from "./base";
import * as tinysecp from "bells-secp256k1";
import bitcore from "bitcore-lib";
import { mnemonicToSeed } from "bip39";
// @ts-ignore
import HDNode, * as hdkey from "hdkey";
import ECPairFactory, { ECPairInterface } from "belpair";
import { Psbt, networks } from "belcoinjs-lib";

const ECPair = ECPairFactory(tinysecp);

const hdPathString = "m/44'/0'/0'/0";

class HDPrivateKey extends BaseWallet implements Keyring<SerializedHDKey> {
  childIndex: number = 0;
  privateKey: Buffer = ZERO_PRIVKEY;
  publicKey = ZERO_KEY;
  wallets: ECPairInterface[] = [];

  private seed?: Uint8Array;
  private _index2wallet: Record<number, [string, ECPairInterface]> = {};
  private hdWallet?: HDNode;
  private root?: HDNode;
  private hdPath: string = hdPathString;

  constructor(options?: PrivateKeyOptions) {
    super();
    if (options) this.fromOptions(options);
  }

  changeHdPath(hdPath: string) {
    this.hdPath = hdPath;

    this.root = this.hdWallet?.derive(this.hdPath) as any;

    this._index2wallet = {};
    this.wallets = [];
  }

  signTypedData(address: string, typedData: Record<string, unknown>) {
    return this.signMessage(address, JSON.stringify(typedData));
  }

  exportPublicKey(address: string) {
    const account = this.findAccount(address);
    return account.publicKey.toString('hex');
  }

  verifyMessage(address: string, text: string, sig: string) {
    const message = new bitcore.Message(text);
    const isVerified = message.verify(address, sig);
    return isVerified;
  }

  getAccounts() {
    const accounts =  this.wallets.map((w) => {
      return this.getAddress(w.publicKey)!;
    });
    return [this.getAddress(this.publicKey!)!, ...accounts]
  }

  addAccounts(number: number = 1) {
    let count = number;
    let currentIdx = this.wallets.length === 0 ? 1 : this.wallets.length;
    const newAddresses: string[] = [];


    while (count) {
      const [address, wallet] = this._addressFromIndex(currentIdx);
      if (this.wallets.includes(wallet)) {
        currentIdx++;
      } else {
        this.wallets.push(wallet);
        newAddresses.push(address);
        count--;
      }
    }

    return newAddresses;
  }

  private findAccount(account: Hex): ECPairInterface {
    const foundAccount = this.wallets.find(
      (f) => this.getAddress(f.publicKey) === account
    );
    if (foundAccount !== undefined) {
      return foundAccount;
    }
    throw new Error(`HDPrivateKey: Account with address ${account} not founded`);
  }

  private findAccountByPk(publicKey: string): ECPairInterface {
    const foundAccount = this.wallets.find(f => f.publicKey.toString('hex') === publicKey);
    if (foundAccount !== undefined) {
      return foundAccount
    }
    throw new Error(`HDPrivateKey: Account with public key ${publicKey} not founded`);
  }

  exportAccount(address: Hex) {
    const account = this.findAccount(address);
    return account.toWIF();
  }

  signPsbt(psbt: Psbt, inputs: ToSignInput[]) {
    let account: ECPairInterface | undefined;

    inputs.map((i) => {
      account = this.findAccountByPk(i.publicKey);
      psbt.signInput(
        i.index,
        ECPair.fromPrivateKey(account.privateKey!, {
          network: networks.bitcoin,
        }),
        i.sighashTypes
      );
    });
    psbt.finalizeAllInputs();
  }

  signMessage(address: Hex, text: string) {
    const keyPair = this._getPrivateKeyFor(
      this.wallets
        .find((f) => this.getAddress(f.publicKey) === address)
        ?.publicKey?.toString("hex") ?? ""
    );
    const message = new bitcore.Message(text);
    return message.sign(
      new bitcore.PrivateKey(keyPair.privateKey?.toString("hex"))
    );
  }

  signPersonalMessage(address: Hex, message: Hex) {
    return this.signMessage(address, message);
  }

  async fromOptions(options: PrivateKeyOptions) {
    this.childIndex = 0;
    this.seed = fromHex(options.seed);
    this.hdWallet = hdkey.fromMasterSeed(Buffer.from(this.seed!));
    this.root = this.hdWallet.derive(this.hdPath) as any;
    this.publicKey = this.root!.publicKey;
    this.privateKey = this.root!.privateKey;

    return this;
  }

  static fromOptions(options: PrivateKeyOptions) {
    return new this().fromOptions(options);
  }

  fromSeed(seed: Uint8Array) {
    this.seed = seed;
    this.hdWallet = hdkey.fromMasterSeed(Buffer.from(seed));
    this.root = this.hdWallet.derive(this.hdPath) as any;

    this.privateKey = this.root!.privateKey;
    this.publicKey = this.root!.publicKey;

    return this;
  }

  static fromSeed(seed: Uint8Array): HDPrivateKey {
    return new this().fromSeed(seed);
  }

  async fromMnemonic(
    mnemonic: string,
    passphrase?: string
  ): Promise<HDPrivateKey> {
    this.seed = await mnemonicToSeed(mnemonic, passphrase ?? "bells");
    this.hdWallet = hdkey.fromMasterSeed(Buffer.from(this.seed!));
    this.root = this.hdWallet.derive(this.hdPath) as any;
    this.publicKey = this.root!.publicKey;
    this.privateKey = this.root!.privateKey;
    return this;
  }

  static fromMnemonic(
    mnemonic: string,
    passphrase?: string
  ): Promise<HDPrivateKey> {
    return new this().fromMnemonic(mnemonic, passphrase);
  }

  fromPhrase(phrase: string): HDPrivateKey {
    this.fromMnemonic(phrase);
    return this;
  }

  static fromPhrase(phrase: string): HDPrivateKey {
    return new this().fromPhrase(phrase);
  }

  fromPrivateKey(_key: Uint8Array) {
    throw new Error("Method not allowed for HDPrivateKey.");
  }

  static fromPrivateKey(key: Uint8Array) {
    return new this().fromPrivateKey(key);
  }

  private getChildCount(): number {
    return this.wallets.length;
  }

  serialize() {
    if (this.childIndex !== 0)
      throw new Error("You should use only root wallet to serializing");
    return {
      numberOfAccounts: this.getChildCount(),
      seed: toHex(this.seed!),
      addressType: this.addressType!,
    };
  }

  static deserialize(opts: SerializedHDKey) {
    if (opts.numberOfAccounts === undefined || !opts.seed) {
      throw new Error(
        "HDPrivateKey: Deserialize method cannot be called with an opts value for numberOfAccounts and no seed"
      );
    }

    const root = HDPrivateKey.fromSeed(fromHex(opts.seed));
    root.addressType = opts.addressType;

    if (!opts.numberOfAccounts) return root;

    root.addAccounts(opts.numberOfAccounts);
    return root;
  }

  deserialize(state: SerializedHDKey) {
    const deserialized = HDPrivateKey.deserialize(state);
    this.fromOptions({
      seed: toHex(deserialized.seed!)
    });
    return this;
  }

  private _addressFromIndex(i: number): [string, ECPairInterface] {
    if (!this._index2wallet[i]) {
      const child = (this.root as unknown as bitcore.HDPrivateKey)?.deriveChild(i);
      const ecpair = ECPair.fromPrivateKey(Buffer.from((child as any).privateKey));
      const address = this.getAddress(ecpair.publicKey)!;
      this._index2wallet[i] = [address, ecpair];
    }

    return this._index2wallet[i];
  }

  private _getPrivateKeyFor(publicKey: string) {
    if (!publicKey) {
      throw new Error("Must specify publicKey.");
    }
    const wallet = this._getWalletForAccount(publicKey);
    return wallet;
  }

  private _getWalletForAccount(publicKey: string) {
    let wallet = this.wallets.find(
      (wallet) => wallet.publicKey.toString("hex") == publicKey
    );
    if (!wallet) {
      throw new Error("Simple Keyring - Unable to find matching publicKey.");
    }
    return wallet;
  }
}

export default HDPrivateKey;