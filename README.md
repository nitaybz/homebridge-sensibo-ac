# homebridge-sensibo-ac
[Homebridge](https://github.com/nfarina/homebridge) plugin for Sensibo Sky - Smart AC Control

`min node version required: 10.17`<br>
`min homebridge version required 0.4.4`<br>
`min iOS version required 11.0.0`

check with:
`node -v` & `homebridge -V`
<br>and update if needed

### Why this plugin?
Taking into consideration the other plugins for Sensibo, I decided to create this plugin using a different service/characteristic ("HeaterCooler") which is a better match to control air conditioners + I've added some extra options that are missing in other plugins.

### so what's actually new in this plugin?
- Accessory type "**HeaterCooler**" - allowing adjusting fan speed (Rotation Speed) & swing (Oscillate) from within the accessory in "Home" App.
- **Auto Detect Configurations** - Automatically detect all your devices and their capabilities and opens up only the options available in Sensibo app to be controlled in HomeKit. More details [below](##Auto-Detect-Configurations).
- **Fan Mode** control (including it's own fan speed and swing control) in a new separate accessory.
- **Dry Mode** control (including it's own fan speed and swing control) in a new separate accessory.
- **AC Sync Button** - allows you to quickly toggle the state of the AC between ON/OFF in case your AC is out of sync with HomeKit (does not send commands to the AC).

# Installation

1. Install homebridge using: `sudo npm install -g homebridge`
2. Install this plugin using: `sudo npm install -g homebridge-sensibo-ac`
3. Update your configuration file. See `sample-config.json` in this repository for a sample.

\* install from git: `sudo npm install -g git+https://github.com/nitaybz/homebridge-sensibo-ac.git`


## Config file

#### Easy config:
```
"platforms": [
    {
        "platform": "SensiboAC",
        "apiKey": "*************"
    }
]
```

#### Advanced config:
```
"platforms": [
    {
        "platform": "SensiboAC",
        "apiKey": "*************",
        "disableFan": false,
        "disableDry": false,
        "enableSyncButton": true,
        "debug": false
    }
]
```

#### How to get an API key:
You can generate an API key from the webapp at https://home.sensibo.com/me/api, once you login with your sensibo account username and password.

# Advanced Control

## Auto Detect Configurations

The plugin will scan for all your devices and retrieve each device capabilities separately. that means, that in HomeKit you will see only the things that the Sensibo app allows you to control.

In practice:
- Minimum and Maximum temperatures are taken from Sensibo api.
- Temperature unit (Celsius/Fahrenheit) is taken from Sensibo api.
- "AUTO" mode is available in the AC states in HomeKit only if it is available in Sensibo app.
- Modes "FAN" and "DRY" (dehumidifier) will create their own accessories only if you have this ability inside Sensibo app.
- Fan Speed ("Rotation Speed" in Home app) And Swing ("Oscillate" in Home app) will show in the accessory settings, but only if you have this capability in Sensibo app.



## State Polling

The accessory state will be updated in the background every 90 seconds, this is hard coded and requested specifically by Sensibo company.
The state will also refresh every time you open the "Home" app or any related HomeKit app.


## Fan Mode

If your Sensibo app can control your AC **FAN** mode, this plugin will create extra fan accessory in HomeKit to control the FAN mode of your device.<br>
it will also include all the fan speeds and swing possibilities you have for FAN mode.

To disable the extra fan accessory, add `"disableFan": true` to your config.


## Dry Mode

If your Sensibo app can control your AC **DRY** mode, this plugin will create extra dehumidifier accessory in HomeKit to control the DRY mode of your device.<br>
it will also include all the fan speeds and swing possibilities you have for DRY mode.

To disable the extra dehumidifier accessory, add `"disableDry": true` to your config.


## AC Sync Button

Does Sensibo shows your AC is ON while it's actually OFF?<br>
Does your sensibo state get out of sync with your AC?<br>
Do you find yourself changing commands from the original remote just for the AC and Sensibo to be in sync?

if you found yourself struggling with the above, this feature is exactly for you!
It allows you to quickly toggle the state in Sensibo and Home app without changing the real state of your device, this will help you to quickly sync between them.

When enabled, this feature creates a new switch accessory in HomeKit. The new switch is stateless, which means that when clicked, it turns back OFF after 1 second. behind the scenes, the plugin changes the state of the device from ON to OFF or the other way around, depends on the current state of the device. all of that, without sending actual commands to the AC! so you can relax while you test this button :)

\* *it is extra necessary if your AC has the same command for ON and  OFF because it can go out of sync easily.*


**To enable the extra "AC Sync" switch**, add 
`"enableSyncButton": true` to your config.

## Fan speeds & "AUTO" speed
Fan speed steps are determined by the steps you have available in the Sensibo app. Since HomeKit control over fan speed is with a slider between 0-100, the plugin converts the steps you have in the Sensibo app to values between 1 to 100, when 100 is highest and 1 is lowest. if "AUTO" speed is available in your setup, setting the fan speed to 0, should actually set it to "AUTO" speed.

## Issues & Debug
If you experience any issues with the plugins please refer to the [Issues](https://github.com/nitaybz/homebridge-sensibo-ac/issues) tab and check if your issue is already described there, if it doesn't, please create a new issue with as much detailed information as you can give (logs are crucial).<br>
if you want to even speed up the process, you can add `"debug": true` to your config, which will give me more details on the logs and speed up fixing the issue.

<br><br>

# Special Thanks
Great thanks to Sensibo company and especially Omer Enbar, their CEO & CO-Founder, which helped me tremendously understanding their best practice, limitation, needs and extra *undocumented* features.