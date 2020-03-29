export enum TransformationType {
  add = 'add',
  multiply = 'multiply',
  subtract = 'subtract',
  divide = 'divide',
  parseInt = 'parseInt',
  floor = 'floor',
  round = 'round',
}

export interface Transformation {
  type: TransformationType;
  value: number;
}

export function applyTransformations(
  transformations: Transformation[],
  value: number
) {
  return transformations.reduce((value, transformation) => {
    switch (transformation.type) {
      case TransformationType.add:
        return value + transformation.value;
      case TransformationType.multiply:
        return value * transformation.value;
      case TransformationType.subtract:
        return value - transformation.value;
      case TransformationType.divide:
        return value / transformation.value;
      case TransformationType.parseInt:
        return parseInt(value.toString());
      case TransformationType.floor:
        return Math.floor(value);
      case TransformationType.round:
        return Math.round(value);
    }
  }, value);
}
