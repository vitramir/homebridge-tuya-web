import TuyaWebApi from './tuyawebapi';
import { BaseAccessory } from './base_accessory';
import R from 'ramda';
import {
  Accessory,
  Service,
  Characteristic,
  CharacteristicEventTypes,
} from 'hap-nodejs';
import { TuyaDevice } from './types';
import {
  Transformation,
  TransformationType,
  applyTransformations,
} from './transformations';

type LightConfig = {
  useCache?: boolean;
  toTuyaBrightness?: Transformation[];
  fromTuyaBrightness?: Transformation[];
  toTuyaTemperature?: Transformation[];
  fromTuyaTemperature?: Transformation[];
};

const defaultConfig = <LightConfig>{
  useCache: true,
  toTuyaBrightness: [],
  fromTuyaBrightness: [
    {
      type: TransformationType.parseInt,
    },
    {
      type: TransformationType.divide,
      value: 255,
    },
    {
      type: TransformationType.multiply,
      value: 100,
    },
    {
      type: TransformationType.floor,
    },
  ],
  toTuyaTemperature: [],
  fromTuyaTemperature: [
    // {
    //   type: TransformationType.parseInt,
    // },
    // {
    //   type: TransformationType.divide,
    //   value: 255,
    // },
    // {
    //   type: TransformationType.multiply,
    //   value: 100,
    // },
    // {
    //   type: TransformationType.floor,
    // },
  ],
};

// homekit compatible defaults
const defaultBrightness = 100; // 100%
const defaultTemperature = 100; // 100%

export class LightTemperatureAccessory extends BaseAccessory {
  private config: LightConfig;
  constructor(
    platform,
    homebridgeAccessory,
    deviceConfig: TuyaDevice,
    config: LightConfig
  ) {
    super(
      platform,
      homebridgeAccessory,
      deviceConfig,
      Accessory.Categories.LIGHTBULB
    );

    this.config = R.merge(defaultConfig, config);

    // Characteristic.On
    this.service
      .getCharacteristic(Characteristic.On)
      .on(CharacteristicEventTypes.GET, async (callback) => {
        // Retrieve state from cache
        try {
          const state = await this.getState();
          callback(null, state.power);
        } catch (err) {
          callback(err);
        }
      })
      .on(CharacteristicEventTypes.SET, (isOn, callback) => {
        // Set device state in Tuya Web API
        const value = isOn ? 1 : 0;

        this.platform.tuyaWebApi
          .setDeviceState(this.deviceId, 'turnOnOff', { value: value })
          .then(() => {
            this.log.debug(
              '[SET][%s] Characteristic.On: %s %s',
              this.homebridgeAccessory.displayName,
              isOn,
              value
            );
            this.setCachedState(Characteristic.On, isOn);
            callback();
          })
          .catch((error) => {
            this.log.error(
              '[SET][%s] Characteristic.On Error: %s',
              this.homebridgeAccessory.displayName,
              error
            );
            this.invalidateCache();
            callback(error);
          });
      });

    // Characteristic.Brightness
    this.service
      .getCharacteristic(Characteristic.Brightness)
      .on(CharacteristicEventTypes.GET, async (callback) => {
        // Retrieve state from cache
        try {
          const state = await this.getState();
          callback(null, state.brightness);
        } catch (err) {
          callback(err);
        }
      })
      .on(CharacteristicEventTypes.SET, async (percentage, callback) => {
        const value = applyTransformations(
          this.config.toTuyaBrightness,
          percentage
        );
        try {
          const result = await this.platform.tuyaWebApi.setDeviceState(
            this.deviceId,
            'brightnessSet',
            { value: value }
          );

          this.log.debug(
            '[SET][%s] Characteristic.Brightness: %s percent',
            this.homebridgeAccessory.displayName,
            percentage
          );
          this.setCachedState(Characteristic.Brightness, percentage);
          callback();
        } catch (error) {
          this.log.error(
            '[SET][%s] Characteristic.Brightness Error: %s',
            this.homebridgeAccessory.displayName,
            error
          );
          this.invalidateCache();
          callback(error);
        }
      });

    // Characteristic.ColorTemperature
    this.service
      .getCharacteristic(Characteristic.ColorTemperature)
      .on(CharacteristicEventTypes.GET, async (callback) => {
        try {
          const state = await this.getState();
          callback(null, state.temperature);
        } catch (err) {
          callback(err);
        }
      })
      .on(CharacteristicEventTypes.SET, async (value, callback) => {
        try {
          const tuyaValue = applyTransformations(
            this.config.toTuyaTemperature,
            value
          );
          const result = await this.platform.tuyaWebApi.setDeviceState(
            this.deviceId,
            'colorTemperatureSet',
            { value: tuyaValue }
          );
          this.setCachedState(Characteristic.ColorTemperature, value);
          callback();
        } catch (err) {
          this.log.error(
            '[SET][%s] Characteristic.ColorTemperature Error: %s',
            this.homebridgeAccessory.displayName,
            err
          );
          this.invalidateCache();
          callback(err);
        }
      });
  }

  async getState() {
    try {
      let power = false;
      let brightness = 100;
      let temperature = 1000;

      if (!this.config.useCache || !this.hasValidCache()) {
        const data = await this.platform.tuyaWebApi.getDeviceState(
          this.deviceId
        );
        this.updateState(data);
      }
      brightness = this.getCachedState(Characteristic.Brightness) as number;
      temperature = this.getCachedState(
        Characteristic.ColorTemperature
      ) as number;

      power = this.getCachedState(Characteristic.On) as boolean;

      return { power, temperature, brightness };
    } catch (err) {
      this.invalidateCache();
      throw err;
    }
  }

  async updateState(data: TuyaDevice['data']) {
    // Update device type specific state
    this.log.debug(
      '[UPDATING][%s]:',
      this.homebridgeAccessory.displayName,
      data
    );

    if (data.state) {
      const isOn = data.state === 'true';
      this.service.getCharacteristic(Characteristic.On).updateValue(isOn);
      this.setCachedState(Characteristic.On, isOn);
    }

    let brightness = defaultBrightness,
      colorTemperature = defaultTemperature;

    brightness = applyTransformations(
      this.config.fromTuyaBrightness,
      data.brightness
    );

    colorTemperature = applyTransformations(
      this.config.fromTuyaTemperature,
      data.color_temp
    );

    this.setCachedState(Characteristic.Brightness, brightness);
    this.service
      .getCharacteristic(Characteristic.Brightness)
      .updateValue(brightness);

    this.setCachedState(Characteristic.ColorTemperature, colorTemperature);
    this.service
      .getCharacteristic(Characteristic.ColorTemperature)
      .updateValue(colorTemperature);
  }
}
