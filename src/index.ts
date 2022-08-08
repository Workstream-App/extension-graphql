
import {
  Extension,
  onAuthenticatePayload,
  onChangePayload,
  onLoadDocumentPayload,
  // @ts-ignore
} from '@hocuspocus/server'
// @ts-ignore
import { Transformer } from '@hocuspocus/transformer'
// @ts-ignore
import axios, { AxiosResponse } from 'axios'

// import { applyUpdate, encodeStateAsUpdate, Doc } from 'yjs';

const DEBUG = false;

export enum Events {
  onAuthenticate = 'authenticate',
  onChange = 'change',
  onConnect = 'connect',
  onLoad = 'load',
  onDisconnect = 'disconnect',
}

/**
 * Defines a data type that contains the TipTap data.
 */
export interface TypesConfig {
  [key: string]: {
    loadGQL: string,
    saveGQL: string,
    saveVars: Function,
    loadVars: Function,
    getJson: Function
  },
};

export interface Configuration {
  debounce: number | false | null,
  debounceMaxWait: number,
  transformer?: Transformer,
  url: string,
  metaDataKey?: string,
  events: Array<Events>,
  parseName: Function,
  userGQL: string | null,
  types: TypesConfig,
};

const MODULE_NAME = 'Graphql'

export class Graphql implements Extension {
  /**
   * Constructor
   */
   constructor(configuration?: Partial<Configuration>) {
    this.configuration = {
      ...this.configuration,
      ...configuration,
    }

    if (!this.configuration.url) {
      throw new Error('url is required!')
    }
  }

  // ============================================================================================

  configuration: Configuration = {
    debounce: 2000,
    debounceMaxWait: 10000,
    url: '',
    events: [
      Events.onChange,
    ],
    parseName: (name: string) => name ,
    userGQL: null,
    types: {},
  };

  // ============================================================================================

  debounced: Map<string, { timeout: NodeJS.Timeout, start: number }> = new Map()

  // ============================================================================================

  /**
   * debounce the given function, using the given identifier
   */
  debounce(id: string, func: Function) {
    const old = this.debounced.get(id)
    const start = old?.start || Date.now()

    const run = () => {
      this.debounced.delete(id)
      func()
    }

    if (old?.timeout) {
      clearTimeout(old.timeout);
    }
    if (Date.now() - start >= this.configuration.debounceMaxWait) {
      return run();
    }

    this.debounced.set(id, {
      start,
      timeout: setTimeout(run, <number> this.configuration.debounce),
    })
  }

  // ============================================================================================

  /**
   * Send a request to the given url containing the given data
   */
  async sendRequest( payload: any) {
    // console.log('sendRequest variables', payload.variables);
    const json = JSON.stringify({ query: payload.gql, variables: payload.variables });
    // @ts-ignore
    return axios.post(
      this.configuration.url,
      json,
      { headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${payload.context.token}`
      }},
    )
  }

// ============================================================================================

  /**
   * onAuthenticate hook
   * @param data onAuthenticatePayload
   * @returns Promise<void>
   */
  async onAuthenticate(data: onAuthenticatePayload){
    const { token } = data;
    if (!this.configuration.events.includes(Events.onAuthenticate)) {
      return
    }
    return this.sendRequest( {
      context: { token },
      gql: this.configuration.userGQL,
    })
    .then((resp) => {
      if ( resp.data.errors ) {
        // throw new Error(resp.data.errors[0].message);
        return null;
      }
      const user = resp.data.data.user;
      return { user, token };
    });
  }

  // ============================================================================================

  /**
   * onLoadDocument hook
   * @param data onLoadDocumentPayload
   * @returns Promise<void>
   */
  async onLoadDocument(data: onLoadDocumentPayload) {
    if (!this.configuration.events.includes(Events.onLoad)) {
      return null;
    }

    const { documentName, context } = data;
    const name = this.configuration.parseName(documentName) || documentName;
    const fieldName = 'default';

    // Check if the given field already exists in the given y-doc.
    // Important: Only import a document if it doesn't exist in the primary data storage!
    if (!data.document.isEmpty(fieldName)) {
      return
    }

    const type = this.configuration.types[name.entityType];
    return this.sendRequest( {
      documentName,
      context,
      gql: type.loadGQL,
      variables: type.loadVars(name.entityID),
    })
    .then((resp) => {
      if ( resp.data.errors ) {
        console.error(`[${MODULE_NAME}.onLoadDocument] Loading document from graphql storage FAILED: ${resp.data.errors[0].message}`);
        data.document.destroy();
        return null;
        // throw new Error(resp.data.errors[0].message);
      }
      // console.info(`[${MODULE_NAME}.onLoadDocument] Persisted document found. Apply its state as an update`);

      const json = type.getJson(resp.data.data, context); // resp.data.data.assetDescription.content.json;

      data.document.getMap(this.configuration.metaDataKey).set('READY', true);
      return this.configuration.transformer?.toYdoc(json, fieldName);
    });
  }

  // ============================================================================================

  /**
   * onChange hook
   * @param data onChangePayload
   * @returns Promise<void>
   */
  async onChange(data: onChangePayload) {
    if (!this.configuration.events.includes(Events.onChange)) {
      return
    }
    const { documentName, context } = data;
    const name = this.configuration.parseName(documentName) || documentName;
    const type = this.configuration.types[name.entityType];

    const save = () => {
      this.sendRequest({
        documentName: data.documentName,
        context: data.context,
        gql: type.saveGQL,
        variables: type.saveVars(name.entityID, data),
       })
       .then((resp) => {
        if ( resp.data.errors ) {
          console.error(`[${MODULE_NAME}.onChange] Saving document to graphql storage FAILED: ${resp.data.errors[0].message}`);
        }
      });
    }

    if (!this.configuration.debounce) {
      return save()
    }

    this.debounce(data.documentName, save)
  }


  /**
   * Save the current YDoc binary to our API
   */
  // async save(docId: string, document: Doc): Promise<void> {
  //   console.info({
  //     label: `${MODULE_NAME}.save`,
  //     message: `${docId} - Saving YDoc to durable storage`,
  //   })
  //   if (DEBUG) {
  //     const prosemirrorJSON = TiptapTransformer.fromYdoc(document, 'default')
  //     console.log('[prosemirrorJSON]', JSON.stringify(prosemirrorJSON))
  //   }
  //   const documentState = encodeStateAsUpdate(document) // is a Uint8Array
  //   // const base64EncodedDocument = JSBase64.fromUint8Array(documentState)
  //   // POST base64EncodedDocument to the API
  //   // await mockSave(base64EncodedDocument)
  // }

      // if ( ydoc ) {
      //   applyUpdate(data.document, encodeStateAsUpdate(ydoc));
      //   return ydoc;
      // }
}
