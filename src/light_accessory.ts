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

type Color = {
  brightness?: number;
  saturation?: number;
  hue?: number;
};

type LightConfig = {
  useCache?: boolean;
  toTuyaBrightness?: Transformation[];
  fromTuyaBrightness?: Transformation[];
  toTuyaColorBrightness?: Transformation[];
  fromTuyaColorBrightness?: Transformation[];
  toTuyaSaturation?: Transformation[];
  fromTuyaSaturation?: Transformation[];
  toTuyaHue?: Transformation[];
  fromTuyaHue?: Transformation[];
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
  toTuyaColorBrightness: [],
  fromTuyaColorBrightness: [],
  toTuyaSaturation: [],
  fromTuyaSaturation: [
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
  toTuyaHue: [],
  fromTuyaHue: [
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
};

// homekit compatible defaults
const defaultBrightness = 100; // 100%
const defaultSaturation = 100; // 100%
const defaultHue = 359; // red (max hue)

export class LightAccessory extends BaseAccessory {
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
          callback(null, state.color.brightness);
        } catch (err) {
          callback(err);
        }
      })
      .on(CharacteristicEventTypes.SET, (percentage, callback) => {
        // NOTE: For some strange reason, the set value for brightness is in percentage
        const value = applyTransformations(
          this.config.toTuyaBrightness,
          percentage
        ); // 0-100

        // Set device state in Tuya Web API
        this.platform.tuyaWebApi
          .setDeviceState(this.deviceId, 'brightnessSet', { value: value })
          .then(() => {
            this.log.debug(
              '[SET][%s] Characteristic.Brightness: %s percent',
              this.homebridgeAccessory.displayName,
              percentage
            );
            this.setCachedState(Characteristic.Brightness, percentage);
            callback();
          })
          .catch((error) => {
            this.log.error(
              '[SET][%s] Characteristic.Brightness Error: %s',
              this.homebridgeAccessory.displayName,
              error
            );
            this.invalidateCache();
            callback(error);
          });
      });

    // Characteristic.Saturation
    this.service
      .getCharacteristic(Characteristic.Saturation)
      .on(CharacteristicEventTypes.GET, async (callback) => {
        try {
          const state = await this.getState();
          callback(null, state.color.saturation);
        } catch (err) {
          callback(err);
        }
      })
      .on(CharacteristicEventTypes.SET, async (percentage, callback) => {
        try {
          let color: Color = (await this.getState()).color;
          this.log.debug(
            '[SET][%s] Characteristic.Saturation: (%s) %s percent',
            this.homebridgeAccessory.displayName,
            color.saturation,
            percentage
          );
          color.saturation = percentage;
          await this.updateColor(color);
          callback();
        } catch (err) {
          callback(err);
        }
      });

    // Characteristic.Hue
    this.service
      .getCharacteristic(Characteristic.Hue)
      .on(CharacteristicEventTypes.GET, async (callback) => {
        // Retrieve state from cache
        try {
          const state = await this.getState();
          callback(null, state.color.hue);
        } catch (err) {
          callback(err);
        }
      })
      .on(CharacteristicEventTypes.SET, async (hue, callback) => {
        try {
          let color: Color = (await this.getState()).color;
          this.log.debug(
            '[SET][%s] Characteristic.Saturation: (%s) %s percent',
            this.homebridgeAccessory.displayName,
            color.saturation,
            hue
          );
          color.saturation = hue;
          await this.updateColor(color);
          callback();
        } catch (err) {
          callback(err);
        }
      });
  }

  async getState() {
    try {
      let power = false;
      let color: Color = {
        brightness: defaultBrightness,
        saturation: defaultSaturation,
        hue: defaultHue,
      };

      if (!this.hasValidCache()) {
        const data = await this.platform.tuyaWebApi.getDeviceState(
          this.deviceId
        );
        this.updateState(data);
      }
      color.brightness = this.getCachedState(
        Characteristic.Brightness
      ) as number;
      color.saturation = this.getCachedState(
        Characteristic.Saturation
      ) as number;
      color.hue = this.getCachedState(Characteristic.Hue) as number;
      power = this.getCachedState(Characteristic.On) as boolean;

      return { power, color };
    } catch (err) {
      this.invalidateCache();
      throw err;
    }
  }

  async updateColor(color: Color) {
    // Set device state in Tuya Web API
    try {
      this.setCachedState(Characteristic.Brightness, color.brightness);
      this.setCachedState(Characteristic.Saturation, color.saturation);
      this.setCachedState(Characteristic.Hue, color.hue);

      color.brightness = applyTransformations(
        this.config.toTuyaColorBrightness,
        color.brightness
      );
      color.saturation = applyTransformations(
        this.config.toTuyaSaturation,
        color.saturation
      );
      color.hue = applyTransformations(this.config.toTuyaHue, color.hue);

      const result = await this.platform.tuyaWebApi.setDeviceState(
        this.deviceId,
        'colorSet',
        { color: color }
      );
    } catch (err) {
      this.log.error(
        '[SET][%s] Characteristic.Saturation Error: %s',
        this.homebridgeAccessory.displayName,
        err
      );
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

    let brightness = null,
      saturation = null,
      hue = null;
    if (data.color) {
      brightness = applyTransformations(
        this.config.fromTuyaColorBrightness,
        data.color.brightness
      );

      saturation = applyTransformations(
        this.config.fromTuyaSaturation,
        data.color.saturation
      );

      hue = applyTransformations(this.config.fromTuyaHue, data.color.hue);
    } else {
      brightness = applyTransformations(
        this.config.fromTuyaBrightness,
        data.brightness
      );
    }

    this.service
      .getCharacteristic(Characteristic.Brightness)
      .updateValue(brightness);
    this.setCachedState(Characteristic.Saturation, brightness);

    this.service
      .getCharacteristic(Characteristic.Saturation)
      .updateValue(saturation);
    this.setCachedState(Characteristic.Saturation, saturation);

    this.service.getCharacteristic(Characteristic.Hue).updateValue(hue);
    this.setCachedState(Characteristic.Hue, hue);
  }
}
