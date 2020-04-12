import {
  Accessory,
  Service,
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicValue,
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

enum DeviceState {
  opening = 1,
  closing = 2,
  stopped = 3,
  open = 4, //virtual state based on cache
  closed = 5, //virtual state based on cache
}

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
          let state = await this.getState();

          if (state === DeviceState.opening || state === DeviceState.open) {
            return 100;
          } else if (
            state === DeviceState.closing ||
            state === DeviceState.closed
          ) {
            return 0;
          } else if (state === DeviceState.stopped) {
            return 50;
          }
        })
      )
      .on(
        CharacteristicEventTypes.SET,
        pifySetEvt(async (percentage) => {
          try {
            if (percentage === 50) {
              this.updateCache(DeviceState.stopped);
              await this.platform.tuyaWebApi.setDeviceState(
                this.deviceId,
                'startStop',
                { value: 0 }
              );
            } else if (percentage === 100) {
              this.updateCache(DeviceState.opening);
              await this.platform.tuyaWebApi.setDeviceState(
                this.deviceId,
                'turnOnOff',
                { value: 1 }
              );
            } else if (percentage === 0) {
              this.updateCache(DeviceState.closing);
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
        let state = await this.getState();

        if (state === DeviceState.opening) {
          return Characteristic.PositionState.INCREASING;
        } else if (state === DeviceState.closing) {
          return Characteristic.PositionState.DECREASING;
        } else if (
          state === DeviceState.closed ||
          state === DeviceState.open ||
          state === DeviceState.closed
        ) {
          return Characteristic.PositionState.STOPPED;
        }
      })
    );

    this.service.getCharacteristic(Characteristic.CurrentPosition).on(
      CharacteristicEventTypes.GET,
      pifyGetEvt(async () => {
        let state = await this.getState();

        if (state === DeviceState.opening || state === DeviceState.open) {
          return 100;
        } else if (
          state === DeviceState.closing ||
          state === DeviceState.closed
        ) {
          return 0;
        } else if (state === DeviceState.stopped) {
          return 50;
        }
      })
    );
  }

  updateCache(state: DeviceState) {
    let prevState: CharacteristicValue = DeviceState.stopped;
    if (this.hasValidCache()) {
      prevState = this.getCachedState(Characteristic.PositionState);
    }
    let newState = state;
    if (
      state === DeviceState.stopped &&
      (prevState === DeviceState.opening || prevState === DeviceState.open)
    ) {
      newState = DeviceState.open;
    } else if (
      state === DeviceState.stopped &&
      (prevState === DeviceState.closing || prevState === DeviceState.closed)
    ) {
      newState = DeviceState.closed;
    }
    this.setCachedState(Characteristic.PositionState, newState);
  }

  async getState() {
    let state: CharacteristicValue;
    if (this.config.useCache && this.hasValidCache()) {
      state = this.getCachedState(Characteristic.PositionState);
    } else {
      const data = await this.platform.tuyaWebApi.getDeviceState(this.deviceId);
      state = data.state;
    }
    return state;
  }

  async updateState(data: TuyaDevice['data']) {
    // Update device type specific state
    this.log.debug(
      '[UPDATING][%s]:',
      this.homebridgeAccessory.displayName,
      data
    );
    this.updateCache(Number(data.state));
    this.service
      .getCharacteristic(Characteristic.PositionState)
      .updateValue(this.getCachedState(Characteristic.PositionState));
  }
}
