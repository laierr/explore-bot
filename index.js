'use strict';

const Promise = require('bluebird'),
  _ = require('lodash'),
  get = Promise.promisify(require('request').get),
  TelegramBot = require('node-telegram-bot-api'),
  qs = require('querystring'),
  CONFIG = require('./config.json'),
  API_URL = "https://api.foursquare.com/v2/venues/explore?";

const getResults = (options, credentials) => {
  const url = API_URL + qs.stringify(_.extend(options, credentials));
  return get(url).get('body').then(JSON.parse);
};

const getVenues = (data) => {
  const items = _.get(data, 'response.groups[0].items'),
    venues = _.map(items, 'venue');

  return venues;
};

const formatAnswer = (venue, index) => {
  return `/${index} ${venue.name}, ${venue.location.address}`;
};

const onLocation = (bot, config, msg) => {
  const id = msg.chat.id,
    ll = msg.location.latitude + ',' + msg.location.longitude,
    limit = 3,
    v = 20160820,
    section = "food",
    options = {limit, ll, section, v};

  getResults(options, config.foursquare_credentials)
    .then(getVenues).map(formatAnswer).then(answers => {
      bot.sendMessage(id, answers.join('\n'));
    }).catch(err => {
      bot.sendMessage(id, err.toString());
    });
};

const start = (config) => {
  const bot = new TelegramBot(config.token, {polling: true});

  bot.on('location', _.partial(onLocation, bot, config));
  console.log('Up, up and away!');
};

if (!module.parent) {
  start(CONFIG);
}
