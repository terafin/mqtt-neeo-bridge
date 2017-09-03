// Requirements
const mqtt = require('mqtt')
const _ = require('lodash')
const logging = require('./homeautomation-js-lib/logging.js')
const url = require('url')
const express = require('express')
const repeat = require('repeat')
const bodyParser = require('body-parser')
const request = require('request')

require('./homeautomation-js-lib/mqtt_helpers.js')

// Config
const brain_IP = process.env.BRAIN_IP
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

    activity_name = _.snakeCase(activity_name)

    if (activity_name === 'poweroff')
        activity_name = 'off'

    return activity_name
}

function startActivity(in_activity) {
    if (_.isNil(in_activity)) return

    var search_activity = updateActivityName(in_activity)
    logging.info('startActivity:' + search_activity)

    var powerOff = in_activity === 'off'

    sendBrainCommand('/v1/api/Recipes', function(error, body) {
        const recipies = JSON.parse(body)
        var done = false

        recipies.forEach(function(recipe) {
            if (done)
                return

            if (recipe.type == 'launch') {
                const deviceName = updateActivityName(decodeURI(recipe.detail.devicename))

                if (powerOff) {
                    sendBrainCommand(recipe.url.setPowerOff, null)
                    done = true
                }
                if (deviceName === search_activity) {
                    sendBrainCommand(recipe.url.setPowerOn, null)
                    done = true
                }
            }
        }, this)

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
    const locationName = body.name
    const value = body.entry
    const components = topic.split('/')

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

function sendBrainCommand(command, callback) {
    var brainURL = 'http://' + brain_IP + ':3000'

    if (_.startsWith(command, 'http://')) {
        brainURL = command
    } else if (command != null) {
        brainURL = brainURL + command
    }

    logging.info('request url: ' + brainURL)

    request(brainURL, function(error, response, body) {
        if ((error !== null && error !== undefined)) {
            logging.error('error:' + error)
            logging.error('response:' + response)
            logging.error('body:' + body)
        }

        if (callback !== null && callback !== undefined) {
            callback(error, body)
        }
    })
}


var currentActivity = null

function updateCurrentActivity(newActivity) {
    if (currentActivity !== newActivity) {
        currentActivity = newActivity
        console.log('current activity is now: ' + currentActivity)
        client.smartPublish(neeo_topic, updateActivityName(currentActivity))
    }
}

function pollBrain() {
    // brain_IP
    // console.log('polling')
    sendBrainCommand('/v1/api/Recipes', function(error, body) {
        const recipies = JSON.parse(body)
        var anythingOn = false
        recipies.forEach(function(recipe) {
            if (recipe.type == 'launch') {
                const deviceName = decodeURI(recipe.detail.devicename)
                const isPoweredOn = recipe.isPoweredOn
                    // console.log('found launch type: ' + deviceName + '   is on: ' + isPoweredOn)

                if (isPoweredOn) {
                    anythingOn = true
                    updateCurrentActivity(deviceName)
                }
            }
        }, this)

        if (!anythingOn) {
            updateCurrentActivity('off')
        }
    })
}

repeat(pollBrain).every(1, 's').start.in(1, 'sec')