# homebridge-sensibo-ac

<img src="branding/sensibo_homebridge.png" width="500" alt="Sensibo and Homebridge logos" />

[![Downloads](https://img.shields.io/npm/dt/homebridge-sensibo-ac.svg?color=critical)](https://www.npmjs.com/package/homebridge-sensibo-ac) [![Version](https://img.shields.io/npm/v/homebridge-sensibo-ac)](https://www.npmjs.com/package/homebridge-sensibo-ac)

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins) [![Homebridge Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=discord)](https://discord.gg/yguuVAX)

[![certified-hoobs-plugin](https://badgen.net/badge/HOOBS/Certified/yellow)](https://plugins.hoobs.org?ref=10876) [![hoobs-support](https://badgen.net/badge/HOOBS/Support/yellow)](https://support.hoobs.org?ref=10876)

[Homebridge](https://github.com/homebridge/homebridge) plugin for [Sensibo](https://sensibo.com/) - Smart AC Controller and Air Purifier

<img src="branding/products.jpg" width="500" alt="Sensibo products" />

## Requirements

![Version](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen)
![Version](https://img.shields.io/badge/homebridge-%3E%3D1.6-brightgreen)
![Version](https://img.shields.io/badge/iOS-%3E%3D11.0-brightgreen)

Check with: `node -v` & `homebridge -V` and update if needed

## Plugin Features

- Login with **username & password** or **API-key** visit [https://home.sensibo.com/me/api](https://home.sensibo.com/me/api) to get your unique API-key
- **Sensibo Sky Support**
- **Sensibo Air Support** including the attached **Room Sensors**
- **Sensibo Air Plus Support** including air quality and CO2
- **Pure Support (Air Purifier)** control, including fan speed and boost control, via a separate accessory
- **Auto Detect Configurations** - Automatically detect your devices, their capabilities and add available control options to the Apple Home app (HomeKit). More details below
- Accessory type **HeaterCooler** - allowing adjusting fan speed (Rotation Speed) & swing (Oscillate) from within the accessory in the Home app
- **Dry Mode** control, including fan speed and swing control, via a separate accessory
- **Fan Mode** control, including fan speed and swing control, via a separate accessory
- **Horizontal Swing** - allows you to enable/disable horizontal swing of your AC
- **Vertical Swing** - allows you to enable/disable vertical swing of your AC
- **AC Sync Button** - easily toggle the state of the AC between ON/OFF in case your AC is out of sync (does not send commands to the AC)
- **Occupancy Sensor** - show the Home/Away status from Sensibo in the Home app via Occupancy sensor
- **Climate React** - enable/disable Climate React (Smart mode). To adjust the settings, turn on Climate Reach Auto Setup
- **Filter Cleaning Indication** - show filter status in the Home app for your accessories. Can be reset in the Eve app
- **History Storage** - store temperature and humidity measurements over time, review them in the Eve app as a graph

## Installation

This plugin is Homebridge verified (and previously HOOBS certified) and can be easily installed and configured through their UI.

### Manual install

If you don't use Homebridge UI or HOOBS, or if you want to know more about the plugin features and options, keep reading...

1. Install Homebridge (using NPM): `sudo npm install -g homebridge --unsafe-perm`
2. Install this plugin: `sudo npm install -g homebridge-sensibo-ac`
3. Update your configuration file. See `config-sample.json` in this repository for a sample.

\* Install directly from GIT: `sudo npm install -g git+https://github.com/nitaybz/homebridge-sensibo-ac.git`

## Configuration

### Easy config (required)

```json
"platforms": [
    {
        "platform": "SensiboAC",
        "username": "******@*******.***",
        "password": "******"
    }
]
```

### Advanced config (optional)

```json
"platforms": [
    {
        "platform": "SensiboAC",
        "apiKey": "***************",
        "allowRepeatedCommands": false,
        "carbonDioxideAlertThreshold": 1500,
        "climateReactSwitchInAccessory": false,
        "disableAirQuality": false,
        "disableCarbonDioxide": false,
        "disableDry": false,
        "disableFan": false,
        "disableHorizontalSwing": false,
        "disableHumidity": false,
        "disableLightSwitch": false,
        "disableVerticalSwing": false,
        "enableClimateReactAutoSetup": false,
        "enableClimateReactSwitch": true,
        "enableHistoryStorage": true,
        "enableOccupancySensor": true,
        "enableSyncButton": true,
        "externalHumiditySensor": false,
        "ignoreHomeKitDevices": false,
        "syncButtonInAccessory": false,
        "devicesToExclude": [],
        "locationsToInclude": [],
        "modesToExclude": [],
        "debug": false
    }
]
```

### Available settings

See below the table for additional details on these settings.

|          Parameter         |                       Description                                | Required |  Default |   type   |
| -------------------------- | ---------------------------------------------------------------- |:--------:|:--------:|:--------:|
| `platform`                 |  Always "SensiboAC"                                              |     ✓    | `SensiboAC` |  String  |
| `apiKey`                   |  Your Sensibo account API key (can be used instead of username/password)    |     ✓*   |     -    |  String  |
| `username`                 |  Your Sensibo account username/email                             |     ✓*   |     -    |  String  |
| `password`                 |  Your Sensibo account password                                   |     ✓*   |     -    |  String  |
| `allowRepeatedCommands`    |  Allow the plugin to send the same state command again           |          |  `false` |  Boolean |
| `carbonDioxideAlertThreshold` |  Value, in PPM, over which the Home app will alert you to high CO2 readings. Requires the Carbon Dioxide Sensor be enabled  |          |  `1500` |  Integer |
| `disableAirQuality`        |  When set to `true`, will remove Air Quality and TVOC readings   |          |  `false` |  Boolean |
| `disableCarbonDioxide`     |  When set to `true`, will remove Carbon Dioxide readings and warnings       |          |  `false` |  Boolean |
| ~~`disableDry`~~           |  ***Deprecated - use modesToExclude*** When set to `true`, will remove the DRY accessory  |          |  `false` |  Boolean |
| ~~`disableFan`~~           |  ***Deprecated - use modesToExclude*** When set to `true`, will remove the FAN accessory  |          |  `false` |  Boolean |
| `disableHumidity`          |  When set to `true`, will remove Current Relative Humidity readings from the (AC) accessory. Humidity will still be shown if you have Dry mode enabled for the accessory  |          |  `false` |  Boolean |
| `externalHumiditySensor`   |  Creates a separate Humidity sensor accessory, ignores the `disableHumidity` setting  |          |  `false` |  Boolean |
| `disableLightSwitch`       |  When set to `true`, will remove the light switch        |          |  `false` |  Boolean |
| `disableHorizontalSwing`   |  When set to `true`, will remove the horizontal swing switch     |          |  `false` |  Boolean |
| `disableVerticalSwing`     |  When set to `true`, will remove the vertical swing control (Oscillate) from the accessory  |          |  `false` |  Boolean |
| `enableClimateReactSwitch` |  Adds a switch to enable/disable Climate React (Smart mode)      |          |  `false` |  Boolean |
| `climateReactSwitchInAccessory` |  When set to `true`, adds a **Climate React** switch (like `enableClimateReactSwitch` above) but within the AC accessory. It will also remove the standalone AC Climate React switch (if one exists). Works only when `enableClimateReactSwitch` is also set to true  |          |  `false` |  Boolean  |
| `enableClimateReactAutoSetup` |  When set to `true`, will auto-update the Climate React (Smart mode) settings to match whenever the AC state is set or changed  |          |  `false` |  Boolean  |
| `enableHistoryStorage`     |  When set to `true`, temperature & humidity measurements will be stored over time, viewable as History in the Eve app  |          |  `false` |   Boolean |
| `enableOccupancySensor`    |  Adds an occupancy sensor to represent the state of someone at home  |          |  `false` |  Boolean  |
| `enableSyncButton`         |  When set to `true`, adds an **AC Sync** switch to toggle the state of the accessory in the Home app, without sending a command to the unit  |          |  `false` |  Boolean  |
| `syncButtonInAccessory`    |  When set to `true`, adds an **AC Sync** switch (like `enableSyncButton` above) but within the acessory. It will also remove the standalone Sync Switch (if one exists)  |          |  `false` |  Boolean  |
| `ignoreHomeKitDevices`     |  Automatically ignore, skip or remove HomeKit supported devices  |          |  `false` |  Boolean |
| `devicesToExclude`         |  Add device identifiers (Name, ID from logs or serial from the Home app) to exclude them from Homebridge  |          |     -    |  String[]  |
| `locationsToInclude`       |  Add device location IDs or names to include when discovering Sensibo devices (leave empty for all locations)  |          |     -    |  String[]  |
| `modesToExclude`           |  Add modes to *exclude* from the accessory in the Home app (leave empty to keep all available modes). Valid values: AUTO, COOL, DRY, FAN, HEAT  |          |     -    |  String[]  |
| `debug`                    |  When set to `true`, the plugin will write extra logs for debugging purposes  |          |  `false` |  Boolean  |

\* *only apiKey OR username / password are required, not both*

## Advanced Control

### Options available

The plugin will scan for all your devices and retrieve each device capabilities separately. Therefore in the Home app you will see only the things that the Sensibo app allows you to control, based on your AC units remote capabilities.

In practice:

- Minimum and Maximum temperatures are taken from Sensibo API
- Temperature unit (Celsius/Fahrenheit) is taken from Sensibo API
- "AUTO" mode is available in the AC states in the Home app only if it is available in Sensibo app
- Modes "DRY" (dehumidifier) and "FAN" will create their own accessories, only if you have this ability in Sensibo app
- Fan Speed ("Rotation Speed" in the Home app) will show in the accessory settings, but only if you have this capability in Sensibo app
- Horizontal Swing capability in Sensibo app will show up as a separate switch in the Home app (because there is no other way to control horizontal swing)
- Vertical Swing ("Oscillate" in the Home app) will show in the accessory settings, but only if you have this capability in Sensibo app
- Use `"ignoreHomeKitDevices": true` to automatically ignore, skip or remove HomeKit supported devices like Sensibo Air and Sensibo Pure.

### State polling

The accessory state will be updated in the background every 90 seconds, this is hard coded and requested specifically by Sensibo company. The state will also refresh every time you open the Home app, or any related HomeKit app.

### Disabling AC modes

If desired, you can choose to hide AC modes from the Home app, preventing you from changing the unit to that mode.

To disable a mode, add `"modesToExclude": ["MODE_TO_HIDE","ANOTHER_MODE_TO_HIDE"]` to your config. Valid values are: `AUTO, COOL, DRY, FAN & HEAT`.

*Note: Including `DRY` or `FAN` in `modesToExclude` will ignore/overwrite the `disableDry` and `disableFan` settings.*

### Dry mode

If your unit has **DRY** mode in the Sensibo app, the plugin will create a dehumidifier accessory in the Home app to control the DRY mode of your device. It will also include all the fan speeds and swing possibilities available from Sensibo.

To remove the separate **Dry** (dehumidifier) accessory, add `"disableDry": true` to your config. `modesToExclude` will overwrite this setting.

***This setting is deprecated, please use `modesToExclude` instead***

### Fan mode

If your unit **FAN** mode in the Sensibo app, this plugin will create a fan accessory in the Home app to control the FAN mode of your device. It will include all the fan speeds and swing possibilities available from Sensibo.

To remove the separate **Fan** accessory, add `"disableFan": true` to your config. `modesToExclude` will overwrite this setting.

***This setting is deprecated, please use `modesToExclude` instead***

### Auto & Fan speeds

Fan speed steps are determined by the steps you have available in the Sensibo app. Since the Home app control over fan speed is with a slider between 0-100, the plugin converts the steps you have in the Sensibo app to values between 1 to 100, when 100 is highest and 1 is lowest. If "Auto" speed is available in your setup, setting the fan speed to 0, will set the unit to "Auto" speed.

*Note: There is a known issue where setting your fan to Auto (0) may result in a subsequent Off command being ignored. Triggering the Off command a second time should update the unit correctly.*

### Horizontal swing

If your Sensibo app has **Horizontal Swing** control, a standalone switch will be added in the Home app to control it.

To remove the **Horizontal Swing** switch, add `"disableHorizontalSwing": true` to your config.

### Vertical swing

If your Sensibo app has **Vertical Swing** control, an "Oscillate" toggle will be added to the existing AC accessory in the Home app to control it.

To disable the **Vertical Swing** (oscillate) toggle, add `"disableVerticalSwing": true` to your config.

Note: Due to Homebridge and Apple (Home app) caching you may need to manually remove the AC accessory to see the change. See [Issue #90](https://github.com/nitaybz/homebridge-sensibo-ac/issues/90) for details. For details on how to remove an accessory take a look at the steps in [Troubleshooting and Debug](#troubleshooting-and-debug) below.

### AC Sync

- Does Sensibo shows your AC is ON while it's actually OFF?
- Does your sensibo state get out of sync with your AC?
- Do you find yourself changing commands from the original remote just for the AC and Sensibo to be in sync?

If you have ever found yourself struggling with the above, this feature is exactly for you! It allows you to toggle the state in the Home app (and update Sensibo) without changing the real state of your device, this will help you to sync between them.

When enabled, a switch will be added. The switch is stateless, which means that when clicked, it turns back OFF after 1 second. Behind the scenes, the plugin toggles the state of the device from ON to OFF (or the other way around, depending on the current state of the device), without sending actual commands to the AC.

*This maybe be required if your AC has the same command for ON and OFF because it can go out of sync easily.*

To add the **AC Sync** switch, add `"enableSyncButton": true` to your config.

To show the **AC Sync** switch within the AC accessory, instead of a separate switch, add `"syncButtonInAccessory": true` to your config.

Note: Setting `"syncButtonInAccessory": true` by itself will create the switch, regardless of `enableSyncButton` value.

### Sensor readings

#### Humidity

The current relative humidity, as reported by the Sensibo device, are shown within the Home app under Climate.

To remove **Humidity** readings from the Home app, add `"disableHumidity": true` to your config.

Note: If you have Dry mode (dehumidifier) enabled, Humidity will always be shown.

To show the **Humidity** reading as a separate sensor, add `"externalHumiditySensor": true` to your config.

Note: Setting `"externalHumiditySensor": true` by itself will create the sensor accessory, regardless of `disableHumidity` value.

#### Air quality and Carbon Dioxide

The current Air Quality, Total Volatile Organic Compounds (TVOCs), in µg/㎥ (micrograms per metre cubed), and Carbon Dioxide (CO2), in Parts Per Million (PPM), as reported by the Sensibo device, are shown within the Home app as an Air Quality and Carbon Dioxide sensor respectively.

The Home app can alert you to high CO2 readings. The default for this plugin is 1500 (PPM). You can change the threshold, by adding `"carbonDioxideAlertThreshold": 1500` to your config, the value must be a whole number. Requires the Carbon Dioxide Sensor be enabled.

To remove **CO2** readings and warnings from the Home app, add `"disableAirQuality": true` to your config.

To remove **Air Quality**a d **TVOC** readings from the Home app, add `"disableAirQuality": true` to your config.

### Occupancy Sensor

Enabling this feature will add **Occupancy Sensor** to the Home app, representing the Home/Away state of the geofence feature in Sensibo app.

Note: Geofencing must be enabled in Sensibo app for it to work

To add the **Occupancy Sensor**, add `"enableOccupancySensor": true` to your config.

### Climate React

Climate React (Smart mode) works similarly to Auto mode on ACs. It aims to keep the temperature between given thresholds.

Use in conjunction with the occupancy sensor and you'll be able to get the "Sensibo Plus" feature that allows turning units on/off according to your geolocation.

Note: To get full options, setup "Climate React" in the Sensibo app first.

#### Climate React switch

When enabled, a switch will be added to the Home app to enable or disable the Climate React mode you've set up in the Sensibo app.

To add the **Climate React** switch, add `"enableClimateReactSwitch": true` to your config.

To show the **Climate React** switch within the AC accessory, instead of a separate switch, also add `"climateReactSwitchInAccessory": true` to your config.

#### Climate React auto setup

When enabled, every time an AC's state is set or changed, the Climate React configuration will be updated so that the desired temperature is maintained.

For example, if setting an AC to Cool and 25°C, Climate React will be set up such that when the temperature rises above 25°C the AC starts to cool and when the temperature drops below 24° (the target temperature minus 1 degree C, or the equivalent F delta), the AC will be turned off.

When setting an AC to Heat with a target temprature, Climate React will be set to plus 1 degree C, or equivalent F delta.

To enable **Climate React Auto Setup**, add `"enableClimateReactAutoSetup": true` to your config.

### Filter cleaning indication

If you have the Filter Cleaning notifications feature in Sensibo (from Sensibo "Plus" subscription or via old account) it will appear in the AC settings in the Home app in this form:

1. **Filer Life Level** - Relative (0-100%) representation of the filter life level. Calculated from the last time it was cleaned until the next time it should be cleaned
2. **Filter Change Indication** - Whether the filter should be cleaned or not (based on usage time).
3. **Reset Filter Indication** - Stateless button (appears only in Eve app due to Apple limitations in the Home app) that resets the counter of the filter life. Normally you would click this button right after you cleaned the filters.

### History storage

Enabling this feature will store measurements of temperature and humidity. This historic data can be viewable in the Eve app under the accessory in a graph.

To enable the **history storage** feature, add `"enableHistoryStorage": true` to your config.

## Troubleshooting and Debug

Start by turning on debug logs, this is done by adding `"debug": true` to your config, saving and restarting Homebridge. This will print additional info in the Homebridge Console Logs, which will give more details on what's happening and may help isolate the issue.

If you are having issues with a particular Sensibo acessory, you could try removing just that accessory from the Homebridge cache (rather than having to reset all of Homebridge which will remove *all* accessories).

To do this, if you are using Homebridge UI (homebridge-config-ui-x) on top of your Homebridge install, try:

- Navigate to `http://<your_homebridge_instance>/settings` in your browser (`Homebridge Settings`)
- Scroll down and click the right hand button next to `Remove Single Cached Accessory`
- From the list presented, click to remove the desired accessory
- Restart Homebridge, hopefully the accessory will then be re-added correctly from the API response!

Note: The accessory may need to be moved back to the correct room in the Home app once re-added.

### Raising an Issue

If you experience any issues with the plugins please refer to the [Issues](https://github.com/nitaybz/homebridge-sensibo-ac/issues) tab or [Sensibo-AC Discord channel](https://discord.gg/yguuVAX) and check if your issue is already described there. If it isn't, please create a new issue with as much detailed information as you can, and please include ***debug logs*** (this is crucial).

## Special thanks

Great thanks to Sensibo company and especially Omer Enbar, their CEO & CO-Founder, who helped tremendously understanding the Sensibo best practices, limitations, needs and extra *undocumented* features.

## Support homebridge-sensibo-ac

**homebridge-sensibo-ac** is a free plugin under the GNU license. It was originally developed as a contribution to the Homebridge/HOOBS community with lots of love and thoughts by [nitaybz](https://github.com/nitaybz). Now maintained by others.

Creating and maintaining Homebridge plugins takes time and effort, if you would like to share your appreciation, feel free to "Star" or donate.

[![Downloads](https://img.shields.io/badge/PayPal-Donate%20to%20nitaybz-blue.svg?logo=paypal)](https://www.paypal.me/nitaybz) [![Downloads](https://img.shields.io/badge/Ko--Fi-Buy%20nitaybz%20a%20coffee-29abe0.svg?logo=ko-fi)](https://ko-fi.com/nitaybz)
