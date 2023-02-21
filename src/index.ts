
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
import axios from 'axios'
import * as Y from 'yjs';
import { toUint8Array } from 'js-base64';

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
    getJson: Function,
    hasYdocState: Function,
    getYdocState: Function,
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

  save(data: onLoadDocumentPayload | onChangePayload) {
    const { documentName, context } = data;
    const name = this.configuration.parseName(documentName) || documentName;
    const type = this.configuration.types[name.entityType];
    const variables = type.saveVars(name.entityID, data);
    if( !variables ) {
      console.error(`[${MODULE_NAME}.onChange]: Error formating data to save`);
      return
    }

    this.sendRequest({
      documentName: data.documentName,
      context: data.context,
      gql: type.saveGQL,
      variables,
     })
     .then((resp) => {
      if ( resp.data.errors ) {
        console.error(`[${MODULE_NAME}.onChange] Saving document to graphql storage FAILED: ${resp.data.errors[0].message}`);
        console.info(`[${MODULE_NAME}.onChange] Graphql variables: ${JSON.stringify(type.saveVars(name.entityID, data))}`);
      }
    },
      (err) => {
        console.error(`[${MODULE_NAME}.onChange] Saving document from graphql storage FAILED: ${err}`);
      });
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
        console.error(`[${MODULE_NAME}.onAuthenticate] Loading user from graphql storage FAILED: ${resp.data.errors[0].message}`);
        throw new Error('Not authorized!')
      }
      const user = resp.data.data.user;
      return { user, token };
    },
    (err) => {
      console.error(`[${MODULE_NAME}.onAuthenticate] Server Error: Loading user from graphql storage FAILED: ${err}`);
      throw new Error(err); });
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
      }


      if( type.hasYdocState(resp.data.data) ) {
        const binaryEncoded = toUint8Array(type.getYdocState(resp.data.data));
        Y.applyUpdate(data.document, binaryEncoded);
        return data.document;
      }

      const json = type.getJson(resp.data.data, data);
      if( !json ) {
        return;
      }

      data.document.getMap(this.configuration.metaDataKey).set('READY', true);
      data.document.merge(this.configuration.transformer?.toYdoc(json, fieldName) || new Y.Doc());
      this.save(data);
    },
    (err) => {
      console.error(`[${MODULE_NAME}.onLoadDocument] Server Error: Loading document from graphql storage FAILED: ${err}`);
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

    if (!this.configuration.debounce) {
      return this.save(data)
    }

    this.debounce(data.documentName, this.save.bind( this, data ));
  }


}
