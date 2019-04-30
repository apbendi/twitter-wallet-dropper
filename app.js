const express = require('express')
const bodyParser = require('body-parser')
const session = require('express-session')
const passport = require('passport')
const TwitterStrategy = require('passport-twitter')
const uuid = require('uuid/v4')
const security = require('./helpers/security')
const auth = require('./helpers/auth')
const cacheRoute = require('./helpers/cache-route')
const socket = require('./helpers/socket')
const nconf = require('nconf')
var Twit = require('twit')

const app = express()

nconf.file({ file: 'config.json' }).env()
const ReceivingUserId = nconf.get('BOT_USER_ID')

const Twitter = new Twit({
  consumer_key:         nconf.get('TWITTER_CONSUMER_KEY'),
  consumer_secret:      nconf.get('TWITTER_CONSUMER_SECRET'),
  access_token:         nconf.get('TWITTER_ACCESS_TOKEN'),
  access_token_secret:  nconf.get('TWITTER_ACCESS_TOKEN_SECRET'),
})

app.set('port', (process.env.PORT || 5000))
app.set('views', __dirname + '/views')
app.set('view engine', 'ejs')

app.use(express.static(__dirname + '/public'))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(passport.initialize());
app.use(session({
  secret: 'keyboard cat',
  resave: false,
  saveUninitialized: true
}))

// start server
const server = app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'))
})

// initialize socket.io
socket.init(server)

// form parser middleware
var parseForm = bodyParser.urlencoded({ extended: false })


/**
 * Receives challenge response check (CRC)
 **/
app.get('/webhook/twitter', function(request, response) {

  var crc_token = request.query.crc_token

  if (crc_token) {
    var hash = security.get_challenge_response(crc_token, auth.twitter_oauth.consumer_secret)

    response.status(200);
    response.send({
      response_token: 'sha256=' + hash
    })
  } else {
    response.status(400);
    response.send('Error: crc_token missing from request.')
  }
})


/**
 * Receives Account Acitivity events
 **/
app.post('/webhook/twitter', function(request, response) {

  console.log(request.body)

  let body = request.body
  let isDirectMessageEvent = body.for_user_id === ReceivingUserId &&
                              body.direct_message_events !== undefined &&
                              Array.isArray(body.direct_message_events)

  if (isDirectMessageEvent) {
    body.direct_message_events.map(processDirectMessageEvent)
  }
  
  socket.io.emit(socket.activity_event, {
    internal_id: uuid(),
    event: request.body
  })

  response.send('200 OK')
})

function processDirectMessageEvent(event) {
  let isNewMsgToUser = event.type === "message_create" && 
                        event.message_create.target.recipient_id === ReceivingUserId

  if (!isNewMsgToUser) {
    return
  }

  let message = event.message_create.message_data.text
  let sender = event.message_create.sender_id

  if (isValidDirectMessage(message, sender)) {
    respondToMessage(message, sender)
  }
}

function isValidDirectMessage(message, sender) {
  // TODO: implement rules here for
  return true
}

function respondToMessage(message, sender) {
  console.log("Message: " + message + " From: " + sender)

  let responseMessage = generateResponse()

  Twitter.post('direct_messages/events/new', {
    "event": {
      "type": "message_create",
      "message_create": {
          "target": {
              "recipient_id": sender
          },
          "message_data": {
              "text": responseMessage
          }
      }
    }
  }, function (err, data, response) {
    if (err) {
      // TODO: Handle errors in some way
      console.log(err)
    }

    console.log(data)
  })
}

function generateResponse() {
  // TODO: business logic to generate the link

  return "Hello there friendo!"
}

/**
 * Serves the home page
 **/
app.get('/', function(request, response) {
  response.render('index')
})


/**
 * Subscription management
 **/
app.get('/subscriptions', auth.basic, cacheRoute(1000), require('./routes/subscriptions'))


/**
 * Starts Twitter sign-in process for adding a user subscription
 **/
app.get('/subscriptions/add', passport.authenticate('twitter', {
  callbackURL: `${nconf.get('BASE_CALLBACK_URL')}/callbacks/addsub`
}));

/**
 * Starts Twitter sign-in process for removing a user subscription
 **/
app.get('/subscriptions/remove', passport.authenticate('twitter', {
  callbackURL: `${nconf.get('BASE_CALLBACK_URL')}/callbacks/removesub`
}));


/**
 * Webhook management routes
 **/
var webhook_view = require('./routes/webhook')
app.get('/webhook', auth.basic, auth.csrf, webhook_view.get_config)
app.post('/webhook/update', parseForm, auth.csrf, webhook_view.update_config)
app.post('/webhook/validate', parseForm, auth.csrf, webhook_view.validate_config)
app.post('/webhook/delete', parseForm, auth.csrf, webhook_view.delete_config)


/**
 * Activity view
 **/
app.get('/activity', auth.basic, require('./routes/activity'))


/**
 * Handles Twitter sign-in OAuth1.0a callbacks
 **/
app.get('/callbacks/:action', passport.authenticate('twitter', { failureRedirect: '/' }),
  require('./routes/sub-callbacks'))

