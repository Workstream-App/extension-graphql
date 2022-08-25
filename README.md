# extension-graphql

 HocusPocus Graphql extension for the HocusPocus framework.

 [![Build Status](https://github.com/Workstream-App/workstream-extension/actions/workflows/build.yml/badge.svg)](https://github.com/Workstream-App/workstream-extension/actions)

## Installation

`$ npm install @Workstream-App/extension-graphql`

Or add this package to your `package.json` file:

```json
"dependencies": {
    @Workstream-App/extension-graphql": "0.X.0"
  }
```

## Usage

```js
import { Graphql, , Events } from '@Workstream-App/extension-graphql';
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { fromUint8Array } from 'js-base64';

const debounce = 5000;
const extensions = // Your tiptap extensions
const transformer = TiptapTransformer.extensions(extensions);
const entityTypes = {
  entityType1: {
    # see entity type definition below
  },
  entityType2: {
    # see entity type definition below
  }
};

const parseName = (name) => {
  const [entityType, entityID] = name.split('.');
  return { entityType, entityID };
};

const server = Server.configure({
  port: 80,

  extensions: [
    new Graphql( {
      url: process.env.GRAPHQL_HTTP,
      parseName,
      // [required if you need to import html] transformer for your document extensions,
      transformer,
      events: [Events.onAuthenticate, Events.onLoad, Events.onChange],
      userGQL: userQuery,
      types: entityTypes,
      // [optional] time in ms the change event should be debounced,
      debounce,
    }),
  ],
})

server.listen()

```

## Entity Types

This graphql extension supports multiple entity types each with their own graphql syntax.

```js
const entityTypes = {
  entityType1: {
    loadGQL: entity1LoadQuery,   // [required] query to load the entity
    // [required] variables to pass to the load query
    loadVars: (entity1Id) => ({ entity1Id }),

    saveGQL: entity1SaveQuery,  // [required] mutation to save the entity
    // [required] variables to pass to the save mutation
    saveVars: (entity1Id, data: onLoadDocumentPayload | onChangePayload ) => {
      const json = TiptapTransformer.fromYdoc(data.document, 'default');
      const html = generateHTML(json, extensions);
      const documentState = Y.encodeStateAsUpdate(data.document);
      const base64Encoded = fromUint8Array(documentState);
      return {
        input: {
          id: entity1Id,
          content: {
            html,
            json: JSON.stringify(json),
            ydoc: base64Encoded,
          },
        },
      };
    },

    // [required] after data is loaded from the server,
    // Doest this data have a ydoc (there is an option to import if needed)
    hasYdocState: (graphQlResp) => {
      return (
        graphQlResp.entity1.ydoc &&
        graphQlResp.entity1.ydoc !== ''
      );
    },
    // [required] if the data has a ydoc, return the ydoc state
    getYdocState: (graphQlResp) => {
      return graphQlResp.entity1.ydoc;
    },

    // [optional] if the data needs to be imported,  return the json state
    getJson: (graphQlResp, data) => {
      const html = graphQlResp.entiry1.html || '<p></p>';
      return generateJSON(html, extensions);
    },
  },
  entity2: ...

};
```

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
