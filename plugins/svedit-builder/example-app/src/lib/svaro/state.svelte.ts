import { getContext, setContext } from 'svelte';

import {
  addComponentInstance,
  createPageState,
  getRenderProps,
  updateComponentProp,
  updateComponentRichText
} from '$lib/hybrid-builder.js';

const SVARO_STATE = Symbol('SVARO_STATE');

class BuilderState {
  _config = $state([]);
  _page = $state(createPageState([]));
  _selectedId = $state(null);

  constructor(config) {
    this._config = config;
    this._page = createPageState(config);
  }

  get config() {
    return this._config;
  }

  get instances() {
    return this._page.instances;
  }

  get selectedId() {
    return this._selectedId;
  }

  get selectedInstance() {
    return this.instances.find((instance) => instance.id === this._selectedId) ?? null;
  }

  add(definitionId) {
    this._page = addComponentInstance(this._page, definitionId);
  }

  select(id) {
    this._selectedId = id;
  }

  removeSelected() {
    if (!this._selectedId) return;
    this._page = {
      ...this._page,
      instances: this.instances.filter((instance) => instance.id !== this._selectedId)
    };
    this._selectedId = null;
  }

  updateProp(instanceId, key, value) {
    this._page = updateComponentProp(this._page, instanceId, key, value);
  }

  updateRichText(instanceId, key, doc) {
    this._page = updateComponentRichText(this._page, instanceId, key, doc);
  }

  getRenderProps(instance) {
    return getRenderProps(instance);
  }
}

export function createBuilderState(config) {
  const state = new BuilderState(config);
  setContext(SVARO_STATE, state);
  return state;
}

export function getBuilderState() {
  return getContext(SVARO_STATE);
}
