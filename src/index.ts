
import {
  Extension,
  onAuthenticatePayload,
  onChangePayload,
  onLoadDocumentPayload,
  onConfigurePayload,
  onConnectPayload,
  onDestroyPayload,
  onDisconnectPayload,
  onListenPayload,
  onRequestPayload,
  onUpgradePayload,
  // @ts-ignore
} from '@hocuspocus/server'
// @ts-ignore
// import { Doc } from 'yjs'
// @ts-ignore
import { TiptapTransformer, Transformer } from '@hocuspocus/transformer'
// @ts-ignore
import axios, { AxiosResponse } from 'axios'
// import { generateJSON } from '@tiptap/html';
// import StarterKit from '@tiptap/starter-kit';
import { applyUpdate, encodeStateAsUpdate, Doc } from 'yjs';

const DEBUG = false;

export enum Events {
  onAuthenticate = 'authenticate',
  onChange = 'change',
  onConnect = 'connect',
  onCreate = 'create',
  onDisconnect = 'disconnect',
}

export interface Configuration {
  debounce: number | false | null,
  debounceMaxWait: number,
  transformer?: Transformer,

  extensions: Array<any>,
  url: string,
  metaDataKey?: string,
  events: Array<Events>,
  updateGQL: string | null,
  loadGQL: string | null,
  userGQL: string | null,
};

const MODULE_NAME = 'Graphql'

export class Graphql implements Extension {
  private logger: any;
  configuration: Configuration = {
    debounce: 2000,
    debounceMaxWait: 10000,
    extensions: [],
    url: '',
    events: [
      Events.onChange,
    ],
    updateGQL: null,
    loadGQL: null,
    userGQL: null,

  }

  debounced: Map<string, { timeout: NodeJS.Timeout, start: number }> = new Map()

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

    if (old?.timeout) clearTimeout(old.timeout)
    if (Date.now() - start >= this.configuration.debounceMaxWait) return run()

    this.debounced.set(id, {
      start,
      timeout: setTimeout(run, <number> this.configuration.debounce),
    })
  }

  /**
   * Send a request to the given url containing the given data
   */
  async sendRequest( payload: any) {
    console.log('sendRequest variables', payload.variables);
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

    /**
   * Save the current YDoc binary to our API
   */
  async save(docId: string, document: Doc): Promise<void> {
    console.info({
      label: `${MODULE_NAME}.save`,
      message: `${docId} - Saving YDoc to durable storage`,
    })
    if (DEBUG) {
      const prosemirrorJSON = TiptapTransformer.fromYdoc(document, 'default')
      console.log('[prosemirrorJSON]', JSON.stringify(prosemirrorJSON))
    }
    const documentState = encodeStateAsUpdate(document) // is a Uint8Array
    // const base64EncodedDocument = JSBase64.fromUint8Array(documentState)
    // POST base64EncodedDocument to the API
    // await mockSave(base64EncodedDocument)
  }


  /**
   * onCreateDocument hook
   */
  async onCreateDocument(data: onLoadDocumentPayload): Promise<any> {
    const { documentName, requestParameters, requestHeaders, context } = data;
    // Check if the given field already exists in the given y-doc.
    // Important: Only import a document if it doesn't exist in the primary data storage!
    if (!data.document.isEmpty('default')) {
      return
    }

    console.info({
      label: `${MODULE_NAME}.onCreateDocument`,
      message: 'Loading document from durable storage',
    })


    await this.sendRequest( {
      context,
      requestHeaders,
      requestParameters: Object.fromEntries(data.requestParameters.entries()),
      gql: this.configuration.userGQL,
    }).then(
      (resp: AxiosResponse<any, any>) => {
        if (resp.data.persistedDocument) {
          console.info({
            label: `${MODULE_NAME}.onCreateDocument`,
            message: 'Persisted document found. Apply its state as an update',
          })
          // Apply the existing updates fetched from the API onto the data.document
          applyUpdate(data.document, encodeStateAsUpdate(resp.data.persistedDocument))
        }
        // Set the READY flag to true using the metaDataKey
        // Clients can use this to determine when the API data has loaded
        data.document.getMap(this.configuration.metaDataKey).set('READY', true)
      },
      (err: Error) => {
        // Issue fetching the doc. Abort
        console.error({
          label: `${MODULE_NAME}.onCreateDocument`,
          message: `Loading document from durable storage FAILED: ${err.message}`,
        })
        // Destroy the document so that no updates can happen
        data.document.destroy()

        // Can we manually disconnect the client here so that y-websocket knows there was an error?
      }
    );

    // use the documents update handler directly instead of using the onChange hook
    // to skip the first change that's triggered by the applyUpdate above
    data.document.on('update', (update: Uint8Array) => {
      console.info({
        label: `${MODULE_NAME}.data.document on update`,
        message: 'Saving document to durable storage',
      })
      this.save(data.documentName, data.document)
    })
    if (DEBUG) {
      const prosemirrorJSON = TiptapTransformer.fromYdoc(
        data.document,
        'default'
      )
      console.log(
        'onCreateDocument[prosemirrorJSON]',
        JSON.stringify(prosemirrorJSON)
      )
    }
  }



  /**
   * onAuthenticate hook
   * @param data onAuthenticatePayload
   * @returns Promise<void>
   * @throws Error
   */
  async onAuthenticate(data: onAuthenticatePayload){
    const { documentName, token, requestHeaders } = data;
    if (!this.configuration.events.includes(Events.onAuthenticate)) {
      return
    }
    console.log('onAuthenticate', documentName);
    return this.sendRequest( {
      context: { token },
      requestHeaders,
      requestParameters: Object.fromEntries(data.requestParameters.entries()),
      gql: this.configuration.userGQL,
    })
    .then((resp) => {
      console.log('server resp', resp.data.errors, resp.data.data);
      if ( resp.data.errors ) {
        throw new Error(resp.data.errors[0].message);
      }
      const user = resp.data.data.user;
      // resp.data.data.token = token;
      return { user, token };
    });
  }




  /** ===========================
   *     onLoadDocument hook
   *  ===========================
   */
  async onLoadDocument(data: onLoadDocumentPayload) {
    const { documentName, requestParameters, requestHeaders, context } = data;
    console.log('onLoadDocument graphql', documentName, requestParameters);
    if (!this.configuration.events.includes(Events.onCreate)) {
      return null;
    }
    const [workspace, workspaceId, entityType, entityID] = documentName.split('.');
    // The Tiptap collaboration extension uses shared types of a single y-doc
    // to store different fields in the same document.
    // The default field in Tiptap is simply called "default"
    const fieldName = 'default';

    // Check if the given field already exists in the given y-doc.
    // Important: Only import a document if it doesn't exist in the primary data storage!
    if (!data.document.isEmpty(fieldName)) {
      return
    }

    console.log('sending request doc parts:', workspace, workspaceId, entityType, entityID);
    return this.sendRequest( {
      documentName,
      requestHeaders,
      // requestParameters: Object.fromEntries(data.requestParameters.entries()),
      context,
      gql: this.configuration.loadGQL,
      variables: { assetId : entityID, }
    })
    .then((resp) => {
      console.log('in onLoadDocument response handler', resp.data.errors, resp.data.data);
      if ( resp.data.errors ) {
        console.error({
          label: `${MODULE_NAME}.onLoadDocument`,
          message: `Loading document from durable storage FAILED: ${resp.data.errors[0].message}`,
        })
        data.document.destroy();
        throw new Error(resp.data.errors[0].message);
      }

      console.info({
        label: `${MODULE_NAME}.onLoadDocument`,
        message: 'Persisted document found. Apply its state as an update',
      })
      const html = resp.data.data.asset.assetDescriptions[0].content.html;
      const json = resp.data.data.asset.assetDescriptions[0].content.json; // generateJSON(html, [StarterKit]);
      const ydoc = resp.data.data.asset.assetDescriptions[0].content.ydoc;
      console.log('on load server resp', ydoc, html, json);

      if ( ydoc ) {
        applyUpdate(data.document, encodeStateAsUpdate(ydoc));
        return ydoc;
      }


      // for (const fieldName in document) {
      //   console.log('fieldName', fieldName);
        // if (data.document.isEmpty(`${requestParameters.get('id')}`)) {
          // data.document.merge( this.configuration.transformer.toYdoc(json,  'default' ));
          // }
      // }
      // console.log('transformer', this.configuration.transformer);
      data.document.getMap(this.configuration.metaDataKey).set('READY', true);
      const ydocr =  this.configuration.transformer?.toYdoc(json, fieldName);
      console.log('ydoc', ydocr);
      return ydocr;
    });



    // if (response.status !== 200 || !response.data) return

    // const document = typeof response.data === 'string'
    //   ? JSON.parse(response.data)
    //   : response.data

    // // eslint-disable-next-line guard-for-in,no-restricted-syntax
    // for (const fieldName in document) {
    //   if (data.document.isEmpty(fieldName)) {
    //     data.document.merge(
    //       this.configuration.transformer.toYdoc(document[fieldName], fieldName),
    //     )
    //   }
    // }
  }



  /**
   * onChange hook
   */
  async onChange(data: onChangePayload) {
    console.log('onChange context', data.context);
    console.log('onChange document', data.documentName);
    console.log('onChange requestHeaders', data.requestParameters);
    if (!this.configuration.events.includes(Events.onChange)) {
      return
    }

    const save = () => {
      this.sendRequest({
        document: TiptapTransformer.fromYdoc(data.document),
        documentName: data.documentName,
        context: data.context,
        requestHeaders: data.requestHeaders,
        requestParameters: Object.fromEntries(data.requestParameters.entries()),
      })
    }

    if (!this.configuration.debounce) {
      return save()
    }

    this.debounce(data.documentName, save)
  }



  /**
   * onConnect hook
   */
  //  async onConnect(data: onConnectPayload) {
  //   console.log('onConnect context', data.request);
  //   if (!this.configuration.events.includes(Events.onConnect)) {
  //     return
  //   }

  //   try {
  //     const response = <AxiosResponse> await this.sendRequest( {
  //       documentName: data.documentName,
  //       requestHeaders: data.requestHeaders,
  //       requestParameters: Object.fromEntries(data.requestParameters.entries()),
  //     })

  //     return typeof response.data === 'string'
  //       ? JSON.parse(response.data)
  //       : response.data
  //   } catch (e) {
  //     // eslint-disable-next-line no-throw-literal
  //     throw null
  //   }
  // }

  async onDisconnect(data: onDisconnectPayload) {
    if (!this.configuration.events.includes(Events.onConnect)) {
      return
    }

    await this.sendRequest( {
      documentName: data.documentName,
      requestHeaders: data.requestHeaders,
      requestParameters: Object.fromEntries(data.requestParameters.entries()),
      context: data.context,
    })
  }

}
