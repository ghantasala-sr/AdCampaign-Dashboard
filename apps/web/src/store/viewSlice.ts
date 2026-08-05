import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  DEFAULT_SORT,
  EMPTY_FILTER,
  type CampaignFilter,
  type CampaignStatus,
  type DateRangePreset,
  type MetricPredicate,
  type ServingStatus,
  type SortableField,
  type SortSpec,
  type SupplySource,
} from '@adsight/types';

/**
 * Client state — what the user has *asked to see*.
 *
 * Nothing in here comes from the server, and nothing in here is a copy of
 * something the server owns. That is the line this project draws between Redux
 * and React Query: Redux holds the question, React Query holds the answer.
 *
 * Filters, sort, and table configuration belong here because they are edited
 * from many disconnected places — the toolbar, the filter panel, a column
 * header, the AI plan review, the URL on first load — and because several of
 * them need to be read together to build one request. Lifting that to component
 * state would mean prop-drilling through the table, and putting it in React
 * Query would mean storing user intent in a cache that is allowed to evict it.
 */

export type Density = 'comfortable' | 'compact';

export interface ViewState {
  readonly filter: CampaignFilter;
  readonly sort: SortSpec;
  /** Column ids the user has hidden. */
  readonly hiddenColumns: readonly string[];
  readonly density: Density;
  readonly filterPanelOpen: boolean;
  readonly aiPanelOpen: boolean;
  /**
   * True once the URL has been read on first mount. The URL is the source of
   * truth for the initial view; until it has been applied, writing back to it
   * would clobber a shared link.
   */
  readonly hydratedFromUrl: boolean;
}

const initialState: ViewState = {
  filter: EMPTY_FILTER,
  sort: DEFAULT_SORT,
  hiddenColumns: [],
  density: 'comfortable',
  filterPanelOpen: false,
  aiPanelOpen: false,
  hydratedFromUrl: false,
};

const viewSlice = createSlice({
  name: 'view',
  initialState,
  reducers: {
    /** Applies a whole view at once — used by URL hydration and the AI plan. */
    viewReplaced(
      state,
      action: PayloadAction<{ filter: CampaignFilter; sort: SortSpec }>,
    ): ViewState {
      return { ...state, filter: action.payload.filter, sort: action.payload.sort };
    },

    hydratedFromUrl(state): ViewState {
      return { ...state, hydratedFromUrl: true };
    },

    searchChanged(state, action: PayloadAction<string>): ViewState {
      return { ...state, filter: { ...state.filter, search: action.payload } };
    },

    statusToggled(state, action: PayloadAction<CampaignStatus>): ViewState {
      return { ...state, filter: { ...state.filter, statuses: toggle(state.filter.statuses, action.payload) } };
    },

    servingStatusToggled(state, action: PayloadAction<ServingStatus>): ViewState {
      return {
        ...state,
        filter: { ...state.filter, servingStatuses: toggle(state.filter.servingStatuses, action.payload) },
      };
    },

    supplySourceToggled(state, action: PayloadAction<SupplySource>): ViewState {
      return {
        ...state,
        filter: { ...state.filter, supplySources: toggle(state.filter.supplySources, action.payload) },
      };
    },

    countryToggled(state, action: PayloadAction<string>): ViewState {
      return {
        ...state,
        filter: {
          ...state.filter,
          countriesOrRegions: toggle(state.filter.countriesOrRegions, action.payload.toUpperCase()),
        },
      };
    },

    metricPredicateAdded(state, action: PayloadAction<MetricPredicate>): ViewState {
      // One predicate per metric: two thresholds on the same metric is almost
      // always a mistake, and the last one entered is the intended one.
      const kept = state.filter.metricPredicates.filter((p) => p.metric !== action.payload.metric);
      return {
        ...state,
        filter: { ...state.filter, metricPredicates: [...kept, action.payload] },
      };
    },

    metricPredicateRemoved(state, action: PayloadAction<number>): ViewState {
      return {
        ...state,
        filter: {
          ...state.filter,
          metricPredicates: state.filter.metricPredicates.filter((_, i) => i !== action.payload),
        },
      };
    },

    dateRangePresetChanged(state, action: PayloadAction<DateRangePreset>): ViewState {
      return {
        ...state,
        filter: {
          ...state.filter,
          dateRange: { preset: action.payload, start: null, end: null },
        },
      };
    },

    customDateRangeChanged(
      state,
      action: PayloadAction<{ start: string; end: string }>,
    ): ViewState {
      return {
        ...state,
        filter: {
          ...state.filter,
          dateRange: { preset: null, start: action.payload.start, end: action.payload.end },
        },
      };
    },

    /** Clicking a column header: same column flips direction, new column resets it. */
    sortRequested(state, action: PayloadAction<SortableField>): ViewState {
      const sameField = state.sort.field === action.payload;
      return {
        ...state,
        sort: {
          field: action.payload,
          direction: sameField ? (state.sort.direction === 'desc' ? 'asc' : 'desc') : 'desc',
        },
      };
    },

    filtersCleared(state): ViewState {
      // The date range is a lens on the data, not a filter on it — clearing
      // "filters" should not silently change which period the user is looking at.
      return {
        ...state,
        filter: { ...EMPTY_FILTER, dateRange: state.filter.dateRange },
      };
    },

    columnToggled(state, action: PayloadAction<string>): ViewState {
      return { ...state, hiddenColumns: toggle(state.hiddenColumns, action.payload) };
    },

    densityChanged(state, action: PayloadAction<Density>): ViewState {
      return { ...state, density: action.payload };
    },

    filterPanelToggled(state): ViewState {
      return { ...state, filterPanelOpen: !state.filterPanelOpen };
    },

    aiPanelToggled(state): ViewState {
      return { ...state, aiPanelOpen: !state.aiPanelOpen };
    },

    aiPanelOpened(state): ViewState {
      return { ...state, aiPanelOpen: true };
    },
  },
});

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export const viewActions = viewSlice.actions;
export const viewReducer = viewSlice.reducer;
