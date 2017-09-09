// Requirements
const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('./homeautomation-js-lib/logging.js')
const url = require('url')
const express = require('express')
const repeat = require('repeat')
const bodyParser = require('body-parser')
const neeoapi = require('neeo-sdk')

require('./homeautomation-js-lib/mqtt_helpers.js')

// Config
const listening_port = process.env.LISTENING_PORT
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



// HS Web API
const app = express()

app.use(bodyParser.json())

app.get('/neeo/*', function(req, res) {
    if (_.isNil(req) || _.isNil(req.url)) {
        res.send('bad request')
        return
    }

    const url_info = url.parse(req.url, true)
    var topic = url_info.pathname
    const body = req.body
        // const locationName = body.name
    const value = body.entry
        // const components = topic.split('/')

    console.log('path: ' + topic)
    console.log('body: ' + body)


    if (_.isNil(body)) {
        res.send('empty body')
        return
    }

    if (!_.isNil(topic) && !_.isNil(value)) {
        client.publish(topic, value)
    }

    res.send('topic: ' + topic + ' value: ' + value)
})

app.listen(listening_port, function() {
    logging.info('Neeo-MQTT listening on port: ' + listening_port, {
        event: 'neeo-startup'
    })
})

var currentActivity = null

function updateCurrentActivity(newActivity) {
    if (currentActivity !== newActivity) {
        currentActivity = updateActivityName(newActivity)
            // console.log('current activity is now: ' + currentActivity)
        client.smartPublish(neeo_topic, currentActivity)
    }
}


function startRecipePoller() {
    repeat(sdkPollForCurrentActivity).every(1, 's').start.in(1, 'sec')
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
            console.error('ERROR enumerating recipes', err)
        })
}

function sdkPollForCurrentActivity() {
    if (_.isNil(connectedBrain))
        return
        // console.log('- Fetch power state of recipes')

    neeoapi.getRecipesPowerState(connectedBrain)
        .then((poweredOnKeys) => {
            // console.log('- Power state fetched, powered on recipes:', poweredOnKeys)

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
    console.log('- use NEEO Brain IP from env variable', brainIp)
    connectedBrain = brainIp
    startRecipePoller()
} else {
    console.log('- discover one NEEO Brain...')
    neeoapi.discoverOneBrain()
        .then((brain) => {
            console.log('- Brain discovered:', brain.name)
            connectedBrain = brain
            startRecipePoller()
        })
}