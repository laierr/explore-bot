'use strict';

const Promise = require('bluebird'),
  _ = require('lodash'),
  get = Promise.promisify(require('request').get),
  TelegramBot = require('node-telegram-bot-api'),
  qs = require('querystring'),
  Redis = require('ioredis'),
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
  const address = _.get(venue, 'location.address', 'Exact address unspecified');
  return `/venue${index + 1} ${venue.name}, ${address}`;
};

const getFromRedis = (redis, id, field) => {
  return new Promise((resolve, reject) => {
    redis.hgetall(`users:${id}`, (error, data) => {
      if (error) {
        return reject;
      }
      try {
        resolve(JSON.parse(data[field]));
      } catch (e) {
        reject(e);
      }
    });
  });
};

const sendVenueLocation = (bot, config, redis, msg, match) => {
  const id = msg.chat.id,
    index = _.toInteger(match[1]),
    venues = getFromRedis(redis, id.toString(), 'answers');

  venues.then(venues => {
    const venue = venues[index - 1],
    openHours = _.get(venue, `hours.status`, `no info`),
    phone = _.get(venue, 'contact.phone', 'no phone'),
    category = _.get(venue, 'categories[0].name', 'no category'),
    address = _.get(venue, 'location.address', 'No address'),
    distance = _.get(venue, 'location.distance', '000');

    return Promise.all([
      bot.sendLocation(id, venue.location.lat,venue.location.lng),
      bot.sendMessage(id,
`${venue.name},
Phone: ${phone}
Category: ${category}
Open hours: ${openHours}
${address} (${distance}m)`)
    ]).return(venues);
  }).then((venues) => {
    const formattedAnswers = _.map(venues, formatAnswer);
    return bot.sendMessage(id, 'Other venues:\n' + formattedAnswers.join('\n'));
  });
};

const onLocation = (bot, config, redis, msg) => {
  const id = msg.chat.id,
    ll = msg.location.latitude + ',' + msg.location.longitude,
    limit = 3,
    v = 20160820,
    section = "food",
    options = {limit, ll, section, v};

  getResults(options, config.foursquare_credentials)
    .then(getVenues).tap(answers => {
      redis.hmset(`users:${id}`, {answers: JSON.stringify(answers)});
    }).map(formatAnswer).then(formattedAnswers => {
      bot.sendMessage(id, formattedAnswers.join('\n'));
    }).catch(err => {
      bot.sendMessage(id, err.toString());
    });
};
const processMessages = (bot, config, redis) => {

  redis.lpop('messages').then(JSON.parse).then((msg) =>{
    const next = _.partial(processMessages, bot, config, redis);

    if (!_.isEmpty(msg)) {
      console.log(msg);
      if (msg.location) {
        onLocation(bot, config, redis, msg);
      }
      next();
    } else {
      setTimeout(next, 200);
    }
    });
};

const start = (config, isWorker) => {
  const bot = new TelegramBot(config.token, {polling: !isWorker}),
    redis = new Redis(config.redis_url);

    console.log("Polling: " + !isWorker);
  if (isWorker) {
    processMessages(bot, config, redis);
  } else {
    bot.on('message', msg => {redis.lpush(`messages`, JSON.stringify(msg))})
    bot.onText(/\/venue(\d+)/, _.partial(sendVenueLocation, bot, config, redis));
  }

  console.log('Up, up and away!');
};

const getConfig = () => {
  try {
    console.log('Trying TEST config')
    return require('./config.json')
  } catch (e) {
    console.log('Failed. We\'re going LIVE!');
    return {
      "token": process.env.TELEGRAM_TOKEN,
      "foursquare_credentials": {
        "client_id": process.env.FOURSQUARE_CLIENT_ID,
        "client_secret": process.env.FOURSQUARE_SECRET
      },
      "redis_url": process.env.REDIS_URL
    }
  }
};


if (!module.parent) {
  start(getConfig(), !_.isEmpty(process.env.WORKER));
}

module.exports.formatAnswer = formatAnswer;
