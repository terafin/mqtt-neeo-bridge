// Requirements
const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('homeautomation-js-lib/logging.js')
const repeat = require('repeat')
const bodyParser = require('body-parser')
const neeoapi = require('neeo-sdk')

require('homeautomation-js-lib/mqtt_helpers.js')

// Config
const listening_port = process.env.LISTENING_PORT
const useWebHook = !_.isNil(listening_port) && listening_port > 0
var neeo_topic = process.env.TOPIC_PREFIX

// Setup MQTT
const client = mqtt.setupClient(function() {
    client.subscribe(neeo_topic + '/set')
}, null)

client.on('message', (topic, message) => {
    logging.info(' ' + topic + ':' + message)
    logging.info(' => need to turn on: ' + message)

    // Send off Neeo command
    startActivity('' + message)
})

function updateActivityName(activity_name) {
    if (_.isNil(activity_name)) return

    activity_name = _.snakeCase(activity_name.toLowerCase())

    if (activity_name === 'poweroff')
        activity_name = 'off'

    return activity_name
}

function startActivity(in_activity) {
    if (_.isNil(in_activity)) return

    var search_activity = updateActivityName(in_activity)
    logging.info('startActivity:' + search_activity)

    var powerOff = in_activity === 'off'

    var done = false

    recipeEnumerator(function(recipe) {
        if (done) return

        const deviceName = updateActivityName(decodeURI(recipe.detail.devicename))

        if (powerOff) {
            recipe.action.powerOff()
            done = true
        }
        if (deviceName === search_activity) {
            recipe.action.powerOn()
            done = true
        }
    })

}

var currentActivity = null

function updateCurrentActivity(newActivity) {
    if (currentActivity !== newActivity) {
        currentActivity = updateActivityName(newActivity)
        // logging.info('current activity is now: ' + currentActivity)
        client.smartPublish(neeo_topic, currentActivity, { retain: true })
    }
}


function startRecipePoller() {
    if ( useWebHook ) {
        sdkPollForCurrentActivity()
        return
    }
    
    //const pollInterval = useWebHook ? 120 : 1
    const pollInterval = 1
    repeat(sdkPollForCurrentActivity).every(pollInterval, 's').start.in(1, 'sec')
}

var connectedBrain = null

function recipeEnumerator(callback) {
    if (_.isNil(connectedBrain))
        return
    if (_.isNil(callback))
        return

    neeoapi.getRecipes(connectedBrain)
        .then((recipes) => {
            recipes.forEach((recipe) => {
                callback(recipe)
            })
        })
        .catch((err) => {
            //if there was any error, print message out to console
            logging.error('ERROR enumerating recipes', err)
        })
}

function sdkPollForCurrentActivity() {
    if (_.isNil(connectedBrain))
        return
        // logging.info('- Fetch power state of recipes')

    neeoapi.getRecipesPowerState(connectedBrain)
        .then((poweredOnKeys) => {
            // logging.info('- Power state fetched, powered on recipes:', poweredOnKeys)

            if (_.isNil(poweredOnKeys) || poweredOnKeys.length == 0) {
                updateCurrentActivity('off')
            } else {
                recipeEnumerator(function(recipe) {
                    if (poweredOnKeys.includes(recipe.powerKey)) {
                        updateCurrentActivity(decodeURIComponent(recipe.detail.devicename))
                    }
                })
            }
        })
}

const brainIp = process.env.BRAIN_IP
if (brainIp) {
    logging.info('- use NEEO Brain IP from env variable', brainIp)
    connectedBrain = brainIp
    startRecipePoller()
} else {
    logging.info('- discover one NEEO Brain...')
    neeoapi.discoverOneBrain()
        .then((brain) => {
            logging.info('- Brain discovered:', brain.name)
            connectedBrain = brain
            startRecipePoller()
        })
}

const http = require('http')
const url = require('url')

function handleBrainData(brainEvent) {
    logging.info('Brain Action', JSON.stringify(brainEvent))

    switch (brainEvent.action) {
        case 'launch':
            logging.info(' >>> ' + brainEvent.recipe + ' was launched!')
            updateCurrentActivity(brainEvent.recipe)
            break
        case 'poweroff':
            logging.info(' >>> Brain powered off')
            updateCurrentActivity('off')
            break
        
    }
}

function getBody(request) {
    return new Promise((resolve, reject) => {
        const body = []
        request
            .on('data', (chunk) => { body.push(chunk) })
            .on('end', () => { resolve(JSON.parse(Buffer.concat(body).toString())) })
            .on('error', (error) => { reject(error) })
    })
}

// VERY primitive REST server, method call is ignored (GET/POST)
function handleRequest(request, response) {
    response.end()
    const dataPromise = getBody(request)
    const requestUrl = url.parse(request.url)
    switch (requestUrl.pathname) {
        case '/':
        case '/neeo':
            dataPromise
                .then(handleBrainData)
                .catch((error) => {
                    logging.error('Error', error)
                })
            break
        default:
            logging.error('invalid url:', requestUrl.pathname)
    }
}

if ( useWebHook ) {
    logging.info('[NEEO] Starting simple webhook server')
    http
        .createServer(handleRequest)
        .listen(listening_port, '0.0.0.0', () => {
            logging.info('[NEEO] Server listening on: http://0.0.0.0:' + listening_port)
        })
}