import IPFS from "ipfs";
import { AutomergeSwarmDocument } from "./automerge-swarm-document";

export class AutomergeSwarm {
  private _ipfsNode: any;
  private _ipfsInfo: any;

  public get ipfsNode(): any {
    return this._ipfsNode;
  }
  public get ipfsInfo(): any {
    return this._ipfsInfo;
  }

  // Initialize
  async connect(addresses: string[]) {
    // Setup IPFS node.
    this._ipfsNode = await IPFS.create({
      config: {
        Addresses: {
          // TODO: Move these into method parameters.
          Swarm: [
            '/ip4/0.0.0.0/tcp/4012',       // This is the desktop/relay node?
            '/ip4/127.0.0.1/tcp/4013/ws'   // This is the signaling web-rtc-star server.
          ],
          API: '/ip4/127.0.0.1/tcp/5012',
          Gateway: '/ip4/127.0.0.1/tcp/9191'
        }
      }
    });
    this._ipfsInfo = await this._ipfsNode.id();
    console.log('IPFS node initialized:', this._ipfsInfo);

    // TODO ===================================================================
    // Listen for sync requests on libp2p channel:
    // https://stackoverflow.com/questions/53467489/ipfs-how-to-send-message-from-a-peer-to-another
    //   Respond with full document or just hashes (compare speed?)
    // /TODO ==================================================================
    
    // Connect to bootstrapping node(s).
    const connectionPromises: Promise<any>[] = [];
    for (const address of addresses) {
      connectionPromises.push(this._ipfsNode.swarm.connect(address));
    }
    await Promise.all(connectionPromises);
  }

  // Open
  doc<T = any>(documentPath: string): AutomergeSwarmDocument<T> | null {
    // Return new document reference.
    return new AutomergeSwarmDocument(this, documentPath)
  }
}

