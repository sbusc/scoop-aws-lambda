/// <reference path="./attesterOptions.types.js" />

/** @type {AttesterOptions} */
export const defaults = {
  attesterType: 'standard'
}

/**
 * Filters a new options object by comparing it with defaults.
 * Will use defaults for missing properties.
 *
 * @param {any} newOptions
 * @returns {AttesterOptions}
 */
export function filterAttesterOptions (newOptions) {
    //TODO not implemented yet
  return newOptions
}
