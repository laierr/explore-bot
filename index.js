'use strict';

const Promise = require('bluebird'),
  _ = require('lodash'),
  fs = require('fs'),
  request = require('request'),
  get = Promise.promisify(request.get),
  TelegramBot = require('node-telegram-bot-api'),
  qs = require('querystring'),
  Redis = require('ioredis'),
  express = require('express'),
  API_URL = "https://api.foursquare.com/v2/venues/explore?";

const getResults = (options, credentials) => {
  const url = API_URL + qs.stringify(_.extend(options, credentials));
  return get(url).get('body').then(JSON.parse);
};

const getAnswers = (data) => {
  return _.get(data, 'response.groups[0].items');
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

const sendVenueList = (bot, id, venues) => {
  const formattedAnswers = _.map(venues, formatAnswer);
  return bot.sendMessage(id, 'Other venues:\n' + formattedAnswers.join('\n'));
};
const getVenueDetails = (venue) => {
  const name = venue.name,
  location = {latitude: venue.location.lat, longitude: venue.location.lng},
  openHours = _.get(venue, `hours.status`, `no info`),
  phone = _.get(venue, 'contact.phone', 'no phone'),
  category = _.get(venue, 'categories[0].name', 'no category'),
  address = _.get(venue, 'location.address', 'No address'),
  distance = _.get(venue, 'location.distance', '000');
  return { name, location, openHours, phone, category, address, distance };
};
const sendVenueLocation = (bot, config, redis, msg, match) => {
  const id = msg.chat.id,
    index = _.toInteger(match[1]),
    answers = getFromRedis(redis, id.toString(), 'answers');

  answers.then(answers => {
    const venues = _.map(answers, 'venue'),
    venue = venues[index - 1],
    tips = answers[index - 1].tips,
    details = getVenueDetails(venue);

    return Promise.all([
      bot.sendLocation(id, details.location.latitude, details.location.longitude),
      bot.sendMessage(id,
`${details.name},
Phone: ${details.phone}
Category: ${details.category}
Open hours: ${details.openHours}
${details.address} (${details.distance}m)
More: /tips${index}`)
    ]).return(venues);
  }).then(_.partial(sendVenueList, bot, id));
};

const getPhoto = (url) => {
    return new Promise((resolve, reject) => {
        request(url).pipe((stream, err) => {
            err ? reject(err) : resolve(stream);
        });
    });
};

const sendVenueTips = (bot, config, redis, msg, match) => {
  const id = msg.chat.id,
    index = _.toInteger(match[1]),
    answers = getFromRedis(redis, id.toString(), 'answers'),
    venues = answers.map(a => a.venue);

    return answers.get(index - 1).get('tips').map(tip => {
        const data = [tip.text];

        if (tip.photourl) {
            data.push(get({url: tip.photourl, encoding: null}).get('body'));
        }

        return Promise.all(data);
    }).map((results) => {
        const [text, photo] = results;

        if (photo) {
            return bot.sendPhoto(id, photo, {caption: text});
        } else {
            return bot.sendMessage(id, text);
        }
    }).return(venues).then(_.partial(sendVenueList, bot, id));
};

const queryAPI  = (config, redis, location) => {
  const ll = location.latitude + ',' + location.longitude,
  limit = 3,
  v = 20160820,
  section = "food",
  options = {limit, ll, section, v};

  return getResults(options, config.foursquare_credentials)
    .then(getAnswers);
};

const onLocation = (bot, config, redis, msg) => {
  const id = msg.chat.id;

  queryAPI(config, redis, msg.location).tap(answers => {
    redis.hmset(`users:${id}`, {answers: JSON.stringify(answers)});
  }).map((a, i) => formatAnswer(a.venue, i)).then(formattedAnswers => {
      bot.sendMessage(id, formattedAnswers.join('\n'));
    }).catch(err => {
      bot.sendMessage(id, err.toString());
    });
};

const processMessages = (bot, config, redis) => {
  redis.lpop('messages').then(JSON.parse).then((msg) =>{
    const next = _.partial(processMessages, bot, config, redis);

    if (!_.isEmpty(msg)) {
      if (msg.location) {
        onLocation(bot, config, redis, msg);
      } else if (msg.text) {
        let match;

        if (match = msg.text.match(/\/venue(\d+)/)){
          sendVenueLocation(bot, config, redis, msg, match);
      } else if (match = msg.text.match(/\/tips(\d+)/)){
          sendVenueTips(bot, config, redis, msg, match);
        }
      }

      next();
    } else {
      setTimeout(next, 200);
    }
    });
};

const webInterface = (config, redis, app) => {
  app.get('/api/v1', (req, res) => {
    const location = req.query.location || {latitude: 32.0878712, longitude: 34.7270341};

    queryAPI(config, redis, location).map(answer =>{
      return getVenueDetails(answer.venue);
    }).then(results => res.send(results));
  });

}

const start = (config, isWorker, isWeb) => {
  const redis = new Redis(config.redis_url);

  if (isWeb) {
    console.log('Launching WEB interface');
    const app = express();
    webInterface(config, redis, app);
    app.listen(8000);
  } else {
    const bot = new TelegramBot(config.token, {polling: !isWorker});

      console.log("Launching BOT.\nPolling: " + !isWorker);

    if (isWorker) {
      processMessages(bot, config, redis);
    } else {
      bot.on('message', msg => {redis.lpush(`messages`, JSON.stringify(msg))})
    }

    console.log('Up, up and away!');
  }

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
  start(getConfig(), !_.isEmpty(process.env.WORKER), !_.isEmpty(process.env.WEB));
}

module.exports.formatAnswer = formatAnswer;
