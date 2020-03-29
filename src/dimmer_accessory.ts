import {
  Accessory,
  Service,
  Characteristic,
  CharacteristicEventTypes,
} from 'hap-nodejs';

import TuyaWebApi from './tuyawebapi';
import { BaseAccessory } from './base_accessory';
import { pifyGetEvt, pifySetEvt } from './promisifyEvent';
import { TuyaDevice } from './types';
import * as R from 'ramda';
import {
  Transformation,
  TransformationType,
  applyTransformations,
} from './transformations';

type DimmerConfig = {
  useCache?: boolean;
  toTuyaBrightness?: Transformation[];
  fromTuyaBrightness?: Transformation[];
};

const defaultConfig = <DimmerConfig>{
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
};

export class DimmerAccessory extends BaseAccessory {
  private config: DimmerConfig;

  constructor(
    platform,
    homebridgeAccessory,
    deviceConfig: TuyaDevice,
    config: DimmerConfig
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
      .on(
        CharacteristicEventTypes.GET,
        pifyGetEvt(async () => {
          // Retrieve state from cache
          if (this.config.useCache && this.hasValidCache()) {
            return this.getCachedState(Characteristic.On);
          } else {
            // Retrieve device state from Tuya Web API
            try {
              const data = await this.platform.tuyaWebApi.getDeviceState(
                this.deviceId
              );
              this.log.debug(
                '[GET][%s] Characteristic.On: %s',
                this.homebridgeAccessory.displayName,
                data.state
              );
              this.setCachedState(Characteristic.On, data.state);
              return data.state;
            } catch (error) {
              this.log.error(
                '[GET][%s] Characteristic.On Error: %s',
                this.homebridgeAccessory.displayName,
                error
              );
              this.invalidateCache();
              throw error;
            }
          }
        })
      )
      .on(
        CharacteristicEventTypes.SET,
        pifySetEvt(async state => {
          // Set device state in Tuya Web API
          const value = state ? 1 : 0;

          try {
            const result = await this.platform.tuyaWebApi.setDeviceState(
              this.deviceId,
              'turnOnOff',
              { value: value }
            );

            this.log.debug(
              '[SET][%s] Characteristic.On: %s %s',
              this.homebridgeAccessory.displayName,
              state,
              value
            );
            this.setCachedState(Characteristic.On, state);
          } catch (error) {
            this.log.error(
              '[SET][%s] Characteristic.On Error: %s',
              this.homebridgeAccessory.displayName,
              error
            );
            this.invalidateCache();
            throw error;
          }
        })
      );

    // Characteristic.Brightness
    this.service
      .getCharacteristic(Characteristic.Brightness)
      .on(
        CharacteristicEventTypes.GET,
        pifyGetEvt(async () => {
          // Retrieve state from cache
          if (this.config.useCache && this.hasValidCache()) {
            return this.getCachedState(Characteristic.Brightness);
          } else {
            // Retrieve device state from Tuya Web API
            try {
              const data = await this.platform.tuyaWebApi.getDeviceState(
                this.deviceId
              );

              const percentage = applyTransformations(
                this.config.fromTuyaBrightness,
                data.brightness
              );
              this.log.debug(
                '[GET][%s] Characteristic.Brightness: %s (%s percent)',
                this.homebridgeAccessory.displayName,
                data.brightness,
                percentage
              );
              this.setCachedState(Characteristic.Brightness, percentage);
              return percentage;
            } catch (error) {
              this.log.error(
                '[GET][%s] Characteristic.Brightness Error: %s',
                this.homebridgeAccessory.displayName,
                error
              );
              this.invalidateCache();
              throw error;
            }
          }
        })
      )
      .on(
        CharacteristicEventTypes.SET,
        pifySetEvt(async percentage => {
          // NOTE: For some strange reason, the set value for brightness is in percentage.

          // Set device state in Tuya Web API
          try {
            const data = await this.platform.tuyaWebApi.setDeviceState(
              this.deviceId,
              'brightnessSet',
              {
                value: applyTransformations(
                  this.config.toTuyaBrightness,
                  percentage as number
                ),
              }
            );

            this.log.debug(
              '[SET][%s] Characteristic.Brightness: %s percent',
              this.homebridgeAccessory.displayName,
              percentage
            );
            this.setCachedState(Characteristic.Brightness, percentage);
          } catch (error) {
            this.log.error(
              '[SET][%s] Characteristic.Brightness Error: %s',
              this.homebridgeAccessory.displayName,
              error
            );
            this.invalidateCache();
            throw error;
          }
        })
      );
  }

  async updateState(data: TuyaDevice['data']) {
    // Update device type specific state
    this.log.debug(
      '[UPDATING][%s]:',
      this.homebridgeAccessory.displayName,
      data
    );
    if (data.state) {
      const state = data.state === 'true';
      this.service.getCharacteristic(Characteristic.On).updateValue(state);
      this.setCachedState(Characteristic.On, state);
    }
    if (data.percentage | data.brightness) {
      const percentage = applyTransformations(
        this.config.fromTuyaBrightness,
        data.percentage || data.brightness
      );
      this.service
        .getCharacteristic(Characteristic.Brightness)
        .updateValue(percentage);
      this.setCachedState(Characteristic.Brightness, percentage);
    }
  }
}
