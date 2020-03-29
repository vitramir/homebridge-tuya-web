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

type WindowCoveringConfig = {
  useCache?: boolean;
  toTuyaBrightness?: Transformation[];
  fromTuyaBrightness?: Transformation[];
};

const defaultConfig = <WindowCoveringConfig>{
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

export class WindowCoveringAccessory extends BaseAccessory {
  private config: WindowCoveringConfig;

  constructor(
    platform,
    homebridgeAccessory,
    deviceConfig: TuyaDevice,
    config: WindowCoveringConfig
  ) {
    super(
      platform,
      homebridgeAccessory,
      deviceConfig,
      Accessory.Categories.WINDOW_COVERING
    );

    this.config = R.merge(defaultConfig, config);

    this.service
      .getCharacteristic(Characteristic.TargetPosition)
      .on(
        CharacteristicEventTypes.GET,
        pifyGetEvt(async () => {
          const data = await this.platform.tuyaWebApi.getDeviceState(
            this.deviceId
          );
          if (data.state === 1) {
            return 100;
          } else if (data.state === 2) {
            return 0;
          } else if (data.state === 3) {
            return 50;
          }
        })
      )
      .on(
        CharacteristicEventTypes.SET,
        pifySetEvt(async percentage => {
          try {
            if (percentage === 50) {
              await this.platform.tuyaWebApi.setDeviceState(
                this.deviceId,
                'startStop',
                { value: 0 }
              );
            } else if (percentage === 100) {
              await this.platform.tuyaWebApi.setDeviceState(
                this.deviceId,
                'turnOnOff',
                { value: 1 }
              );
            } else if (percentage === 0) {
              await this.platform.tuyaWebApi.setDeviceState(
                this.deviceId,
                'turnOnOff',
                { value: 0 }
              );
            }
          } catch (err) {
            console.log(err);
          }
        })
      ).props.minStep = 50;

    this.service.getCharacteristic(Characteristic.PositionState).on(
      CharacteristicEventTypes.GET,
      pifyGetEvt(async () => {
        const data = await this.platform.tuyaWebApi.getDeviceState(
          this.deviceId
        );
        if (data.state === 1) {
          return Characteristic.PositionState.INCREASING;
        } else if (data.state === 2) {
          return Characteristic.PositionState.DECREASING;
        } else if (data.state === 3) {
          return Characteristic.PositionState.STOPPED;
        }
      })
    );

    this.service.getCharacteristic(Characteristic.CurrentPosition).on(
      CharacteristicEventTypes.GET,
      pifyGetEvt(async () => {
        const data = await this.platform.tuyaWebApi.getDeviceState(
          this.deviceId
        );
        if (data.state === 1) {
          return 100;
        } else if (data.state === 2) {
          return 0;
        } else if (data.state === 3) {
          return 50;
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
  }
}
