'use strict';

const Hapi = require('hapi');
const Nes = require('nes');
const Graphi = require('.');

const internals = {
  people: {}
};

const schema = `
  type Person {
    firstname: String!
    lastname: String!
  }

  type Query {
    people: [Person]
    person(firstname: String!): Person!
  }

  type Mutation {
    addPerson(firstname: String!, lastname: String!): Person!
  }

  type Subscription {
    personAdded: Person!
  }
`;

const getPeople = function (args, request) {
  return Object.values(internals.people);
};

const getPerson = function (args, request) {
  return internals.people[args.firstname];
};

const addPerson = function (args, request) {
  request.server.graphql.pub('personAdded', args);
  return internals.people[args.firstname] = args;
};

const resolvers = {
  people: getPeople,
  person: getPerson,
  addPerson
};


internals.init = async () => {
  const server = new Hapi.Server({ port: 8000 });

  await server.register([Nes, { plugin: Graphi, options: { schema, resolvers } }]);
  await server.start();

  console.log(`server.info.uri ${server.info.uri}`);
  // open http://localhost:8000/graphiql?query=%7B%20person(firstname%3A%20%22billy%22)%20%7B%20lastname%20%7D%20%7D&variables=%7B%7D
  // curl -X POST -H "Content-Type: application/json" -d '{"query":"{person(firstname:\"billy\"){lastname}}"}' http://127.0.0.1:8000/graphql
};

internals.init();
