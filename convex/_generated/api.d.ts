/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as budget from "../budget.js";
import type * as execute from "../execute.js";
import type * as lib_factory from "../lib/factory.js";
import type * as lib_records from "../lib/records.js";
import type * as lib_telemetry from "../lib/telemetry.js";
import type * as lib_validators from "../lib/validators.js";
import type * as me from "../me.js";
import type * as operator from "../operator.js";
import type * as permissions from "../permissions.js";
import type * as pilot from "../pilot.js";
import type * as proposals from "../proposals.js";
import type * as queue from "../queue.js";
import type * as results from "../results.js";
import type * as review from "../review.js";
import type * as sessions from "../sessions.js";
import type * as suite from "../suite.js";
import type * as telemetry from "../telemetry.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  budget: typeof budget;
  execute: typeof execute;
  "lib/factory": typeof lib_factory;
  "lib/records": typeof lib_records;
  "lib/telemetry": typeof lib_telemetry;
  "lib/validators": typeof lib_validators;
  me: typeof me;
  operator: typeof operator;
  permissions: typeof permissions;
  pilot: typeof pilot;
  proposals: typeof proposals;
  queue: typeof queue;
  results: typeof results;
  review: typeof review;
  sessions: typeof sessions;
  suite: typeof suite;
  telemetry: typeof telemetry;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
