/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

/* tslint:disable no-console */
import {
  AggregationSearchResponse,
  ESFilter,
  SearchParams
} from 'elasticsearch';
import { Legacy } from 'kibana';
import { merge } from 'lodash';
import moment from 'moment';
import { OBSERVER_VERSION_MAJOR } from 'x-pack/plugins/apm/common/elasticsearch_fieldnames';

function decodeEsQuery(esQuery?: string) {
  return esQuery ? JSON.parse(decodeURIComponent(esQuery)) : null;
}

export type ESClient = <T = void, U = void>(
  type: string,
  params: SearchParams
) => Promise<AggregationSearchResponse<T, U>>;

export interface Setup {
  start: number;
  end: number;
  esFilterQuery?: ESFilter;
  client: ESClient;
  config: Legacy.KibanaConfig;
}

interface APMRequestQuery {
  _debug: string;
  start: string;
  end: string;
  esFilterQuery: string;
}

function addFilterForLegacyData(params: SearchParams) {
  // ensure a filter exists
  const nextParams = merge({}, params, {
    body: { query: { bool: { filter: [] } } }
  });

  // add to filter
  nextParams.body.query.bool.filter.push({
    range: { [OBSERVER_VERSION_MAJOR]: { gte: 7 } }
  });

  return nextParams;
}

export function setupRequest(req: Legacy.Request): Setup {
  const query = (req.query as unknown) as APMRequestQuery;
  const cluster = req.server.plugins.elasticsearch.getCluster('data');
  const uiSettings = req.getUiSettingsService();

  const client: ESClient = async (type, params) => {
    const includeFrozen = await uiSettings.get('search:includeFrozen');

    const nextParams = {
      ...addFilterForLegacyData(params), // filter out pre-7.0 data
      ignore_throttled: !includeFrozen, // whether to query frozen indices or not
      rest_total_hits_as_int: true // ensure that ES returns accurate hits.total with pre-6.6 format
    };

    if (query._debug) {
      console.log(`DEBUG ES QUERY:`);
      console.log('includeFrozen: ', includeFrozen);
      console.log(
        `${req.method.toUpperCase()} ${req.url.pathname} ${JSON.stringify(
          query
        )}`
      );
      console.log(`GET ${nextParams.index}/_search`);
      console.log(JSON.stringify(nextParams.body, null, 4));
    }

    return cluster.callWithRequest(req, type, nextParams);
  };

  return {
    start: moment.utc(query.start).valueOf(),
    end: moment.utc(query.end).valueOf(),
    esFilterQuery: decodeEsQuery(query.esFilterQuery),
    client,
    config: req.server.config()
  };
}
