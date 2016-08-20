'use strict';

const Promise = require('bluebird'),
  _ = require('lodash'),
  get = Promise.promisify(require('request').get),
  TelegramBot = require('node-telegram-bot-api'),
  qs = require('querystring'),
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
  return `/venue${index + 1} ${venue.name}, ${venue.location.address}`;
};

const sendVenueLocation = (bot, config, cache, msg, match) => {
  const id = msg.chat.id,
    index = _.toInteger(match[1]),
    venues = _.get(cache, `${id}.answers`),
    venue = venues[index - 1];

  Promise.all([
    bot.sendLocation(id, venue.location.lat,venue.location.lng),
    bot.sendMessage(id, `${venue.name},
Phone: ${venue.contact.phone}
Category: ${venue.categories[0].name}
${venue.hours.status || ''}
${venue.location.address} (${venue.location.distance}m)`)
  ]).then(() => {
    const formattedAnswers = _.map(venues, formatAnswer);
    return bot.sendMessage(id, 'Other venues:\n' + formattedAnswers.join('\n'));
  });
};

const onLocation = (bot, config, cache, msg) => {
  const id = msg.chat.id,
    ll = msg.location.latitude + ',' + msg.location.longitude,
    limit = 3,
    v = 20160820,
    section = "food",
    options = {limit, ll, section, v};

  getResults(options, config.foursquare_credentials)
    .then(getVenues).tap(answers => {
      _.set(cache, `${id}.answers`, answers);
    }).map(formatAnswer).then(formattedAnswers => {
      bot.sendMessage(id, formattedAnswers.join('\n'));
    }).catch(err => {
      bot.sendMessage(id, err.toString());
    });
};

const start = (config) => {
  console.log(config);

  const bot = new TelegramBot(config.token, {polling: true}),
    cache = {};

  bot.on('location', _.partial(onLocation, bot, config, cache));
  bot.onText(/\/venue(\d+)/, _.partial(sendVenueLocation, bot, config, cache));

  console.log('Up, up and away!');
};

const getConfig = () => {
  //  CONFIG = require('./config.json')

  return {
    "token": process.env.TELEGRAM_TOKEN,
    "foursquare_credentials": {
      "client_id": process.env.FOURSQUARE_CLIENT_ID,
      "client_secret": process.env.FOURSQUARE_SECRET
    }
  }
};

if (!module.parent) {
  start(getConfig());
}

module.exports.formatAnswer = formatAnswer;
