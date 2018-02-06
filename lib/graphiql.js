module.exports = function (data) {
    var endpointURL = data.endpointURL;
    var graphqlPath = data.graphqlPath;
    var queryString = data.query;
    var variablesString = data.variables ? JSON.stringify(data.variables, null, 2) : null;
    var resultString = null;
    var operationName = data.operationName;
    var passHeader = data.passHeader || '';
    var websocketConnectionParams = data.websocketConnectionParams || null;

    let wsIncludeScript = '';
    let wsScript = 'var subscriptionsClient;';
    if (data.usingWs) {
      wsIncludeScript = `
    <script src="//cdnjs.cloudflare.com/ajax/libs/nes/7.0.2/client.js"></script>
    `;

      let connectionParams = '';
      if (websocketConnectionParams) {
        connectionParams = `connectionParams: ${JSON.stringify(websocketConnectionParams)}`;
      }

      wsScript = `
    var wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    var subscriptionsEndpoint = wsProtocol + window.location.host + '${graphqlPath}';
    var subscriptionsClient = new nes.Client(subscriptionsEndpoint);
    async function connect () {
      await subscriptionsClient.connect();
    }
    connect();
    `;
    }

    return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>GraphiQL</title>
    <meta name="robots" content="noindex" />
    <style>html, body { height: 100%; margin: 0; overflow: hidden; width: 100%; }</style>
    <link href="//unpkg.com/graphiql@latest/graphiql.css" rel="stylesheet" />
    <script src="//unpkg.com/react@15.6.1/dist/react.min.js"></script>
    <script src="//unpkg.com/react-dom@15.6.1/dist/react-dom.min.js"></script>
    <script src="//unpkg.com/graphiql@latest/graphiql.min.js"></script>
    <link href="//cdn.jsdelivr.net/npm/codemirror@5/theme/monokai.min.css" rel="stylesheet" />
    <script src="//cdn.jsdelivr.net/fetch/2.0.1/fetch.min.js"></script>
    ${wsIncludeScript}
  </head>
<body>
  <script>
    // Collect the URL parameters
    var parameters = {};
    window.location.search.substr(1).split('&').forEach(function (entry) {
      var eq = entry.indexOf('=');
      if (eq >= 0) {
        parameters[decodeURIComponent(entry.slice(0, eq))] = decodeURIComponent(entry.slice(eq + 1));
      }
    });

    // Produce a Location query string from a parameter object.
    function locationQuery (params, location) {
      return (location || '') + '?' + Object.keys(params).map(function (key) {
        return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
      }).join('&');
    }

    // Derive a fetch URL from the current URL, sans the GraphQL parameters.
    var graphqlParamNames = {
      query: true,
      variables: true,
      operationName: true
    };
    var otherParams = {};
    for (var k in parameters) {
      if (parameters.hasOwnProperty(k) && graphqlParamNames[k] !== true) {
        otherParams[k] = parameters[k];
      }
    }

    ${wsScript}

    // We don't use safe-serialize for location, because it's not client input.
    var fetchURL = locationQuery(otherParams, '${endpointURL}');

    // Defines a GraphQL fetcher using the fetch API.
    function graphQLHttpFetcher(graphQLParams) {
      return fetch(fetchURL, {
        method: 'post',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ${passHeader}
        },
          body: JSON.stringify(graphQLParams),
          credentials: 'same-origin',
        }).then(function (response) {
          return response.text();
        }).then(function (responseBody) {
          try {
            return JSON.parse(responseBody);
          } catch (error) {
            return responseBody;
          }
      });
    }

    function hasSubscriptionOperation (graphQLParams) {
      return graphQLParams.query.indexOf('subscription') >= 0;
    }

    async function graphQLWsFetcher (graphQLParams) {
      if (!hasSubscriptionOperation(graphQLParams)) {
        return graphQLHttpFetcher(graphQLParams);
      }

      return {
        subscribe: function (observer) {
          observer.next('Your subscription data will appear here after server publication!');
          subscriptionsClient.subscribe('/graphql/personAdded', function (update, flags) {
            observer.next(update);
          });
        }
      };
    };

    var fetcher = graphQLHttpFetcher;
    if (subscriptionsClient) {
      fetcher = graphQLWsFetcher;
    }

    // When the query and variables string is edited, update the URL bar so
    // that it can be easily shared.
    function onEditQuery(newQuery) {
      parameters.query = newQuery;
      updateURL();
    }
    function onEditVariables(newVariables) {
      parameters.variables = newVariables;
      updateURL();
    }
    function onEditOperationName(newOperationName) {
      parameters.operationName = newOperationName;
      updateURL();
    }
    function updateURL() {
      var cleanParams = Object.keys(parameters).filter(function(v) {
        return parameters[v];
      }).reduce(function(old, v) {
        old[v] = parameters[v];
        return old;
      }, {});
      history.replaceState(null, null, locationQuery(cleanParams) + window.location.hash);
    }

    // Render <GraphiQL /> into the body.
    ReactDOM.render(
      React.createElement(GraphiQL, {
        fetcher: fetcher,
        onEditQuery: onEditQuery,
        onEditVariables: onEditVariables,
        onEditOperationName: onEditOperationName,
        query: ${JSON.stringify(queryString)},
        response: ${JSON.stringify(resultString)},
        variables: ${JSON.stringify(variablesString)},
        operationName: ${JSON.stringify(operationName)},
        editorTheme: 'monokai',
        websocketConnectionParams: ${JSON.stringify(websocketConnectionParams)}
      }),
      document.body
    );
  </script>
</body>
</html>`;
}
