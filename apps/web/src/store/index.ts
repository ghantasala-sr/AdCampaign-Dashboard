import { combineReducers, configureStore } from '@reduxjs/toolkit';

import { viewReducer } from './viewSlice';

const rootReducer = combineReducers({ view: viewReducer });

export type RootState = ReturnType<typeof rootReducer>;

/**
 * A store factory, not a singleton: tests build a fresh store per case, and Next
 * would otherwise share one store across requests during SSR.
 */
export function makeStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: rootReducer,
    preloadedState,
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore['dispatch'];
