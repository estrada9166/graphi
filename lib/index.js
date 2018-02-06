'use strict';

const Boom = require('boom');
const Graphql = require('graphql');
const Merge = require('lodash.merge');
const GraphiQL = require('./graphiql');
const Package = require('../package.json');


const internals = {
  defaults: {
    graphqlPath: '/graphql',
    graphiqlPath: '/graphiql',
    authStrategy: false,
    graphiAuthStrategy: false
  }
};


exports.register = function (server, options) {
  const settings = Object.assign({}, internals.defaults, options);

  let schema = options.schema;
  let resolvers = {};
  const serverGraphql = {};

  if (schema && typeof schema === 'string') {
    options.schema += 'scalar JoiString';
    const parsed = Graphql.parse(options.schema);
    schema = Graphql.buildASTSchema(parsed);
    resolvers = Merge({}, options.resolvers);
  }

  if (schema && schema._subscriptionType) {
    server.dependency('nes');
  }

  server.ext({
    type: 'onPreStart',
    method: () => {
      const resolver = async (payload, request, ast) => {
        const url = `/${ast.fieldName}`;
        const res = await request.server.inject({
          method: 'graphql',
          url,
          payload,
          headers: request.headers
        });

        if (res.statusCode < 400) {
          return res.result;
        }

        return new Boom(res.result.message, {
          statusCode: res.statusCode,
          data: {
            error: res.result.error,
            url
          }
        });
      };

      server.table().forEach((route) => {
        if (route.method !== 'graphql') {
          return;
        }
        const path = route.path.substr(1);
        resolvers[path] = resolver;
      });

      if (schema._subscriptionType) {
        // subscriptions is a mapping of url path to subscription method
        const subscriptions = internals.setSubscriptions(schema._subscriptionType.getFields(), server, resolvers);
        serverGraphql.pub = internals.publish(server, subscriptions);
      }

      server.expose('resolvers', resolvers);
    }
  });

  server.expose('schema', schema);
  server.expose('settings', settings);
  server.decorate('server', 'graphql', serverGraphql);
  const tags = ['graphql'];

  const route = {
    method: '*',
    path: settings.graphqlPath,
    config: {
      tags,
      auth: settings.authStrategy,
      handler: internals.graphqlHandler
    }
  };

  server.route(route);

  if (settings.graphiqlPath) {
    server.route({
      method: '*',
      path: settings.graphiqlPath,
      config: {
        tags,
        auth: settings.graphiAuthStrategy,
        handler: internals.graphiqlHandler
      }
    });
  }
};

exports.pkg = Package;


internals.graphqlHandler = async function (request, h) {
  if (request.method.toUpperCase() === 'OPTIONS') {
    return h.continue;
  }

  const { schema, resolvers } = request.server.plugins.graphi;
  const source = request.method.toUpperCase() === 'GET' ? request.query : (request.payload || {});

  const operationName = source.operationName;
  const variables = internals.tryParseVariables(source.variables);
  if (variables && variables.isBoom) {
    return variables;
  }

  let queryAST;
  try {
    queryAST = Graphql.parse(source.query);
  } catch (err) {
    return Boom.badRequest('invalid GraqhQL request', err);
  }

  try {
    const errors = Graphql.validate(schema, queryAST);
    if (errors.length) {
      return Boom.badRequest(errors.join(', '));
    }
  } catch (ex) {
    request.log(['error', 'graqhql-error', 'graphql-validate'], ex);
    return Boom.badRequest('invalid GraqhQL request', ex);
  }


  const result = await Graphql.execute(schema, queryAST, resolvers, request, variables, operationName);
  if (result.errors) {
    request.log(['error', 'graqhql-error'], result);
  }

  return result;
};

internals.graphiqlHandler = function (request, h) {
  const { settings } = request.server.plugins.graphi;
  const query = request.query;
  const variables = query.variables || '{}';
  const prefix = request.route.realm.modifiers.route.prefix || '';

  return GraphiQL({
    endpointURL: prefix + settings.graphqlPath,
    usingWs: !!request.server.plugins.nes,
    graphqlPath: settings.graphqlPath,
    query: query.query,
    variables: JSON.parse(variables),
    operationName: query.operationName
  });
};

internals.tryParseVariables = function (input) {
  if (!input || typeof input !== 'string') {
    return input;
  }

  try {
    return JSON.parse(input);
  } catch (error) {
    return Boom.badRequest('Unable to JSON.parse variables', error);
  }
};

internals.publish = function (server, subscriptions) {
  return function (name, obj) {
    const subscription = subscriptions[name];
    const pathParts = subscription.split('/').map((pathPart) => {
      if (!/\{/.test(pathPart)) {
        return pathPart;
      }
      // strip out {}
      const argName = pathPart.substr(1, pathPart.length - 2);
      return String(obj[argName]);
    });

    const publishPath = pathParts.join('/');
    console.log(publishPath)
    server.publish(publishPath, obj);
  };
};

internals.setSubscriptions = function (fields, server, resolvers) {
  const subscriptions = {};
  for (const fieldName in fields) {
    const field = fields[fieldName];
    const path = internals.getSubscriptionPath(field);
    server.subscription(path);
    subscriptions[fieldName] = path;
    resolvers[fieldName] = internals.invalidSubscriber;
  }

  return subscriptions;
};

internals.getSubscriptionPath = function (field) {
  let path = `/graphql/${field.name}`;
  for (const arg of field.args) {
    path += `/{${arg.name}}`;
  }

  return path;
};

internals.invalidSubscriber = function (args, request) {
  return Boom.badRequest('Must use NES compatible client to use subscriptions');
};
