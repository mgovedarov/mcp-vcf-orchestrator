import type {
  Action,
  ConfigAttribute,
  ConfigElement,
  Deployment,
  Subscription,
} from "./types.js";
import { type ContentMetadata, contentMetadata } from "./content-metadata.js";
import {
  REDACTED,
  isSecureAttributeValue,
  redactSensitiveValues,
} from "./redaction.js";

/**
 * Project a live vRO/VCFA record into the form a `vcfa://` resource may serve.
 *
 * **The contract: a resource withholds what its matching `get-*` tool
 * withholds.** Both surfaces read the same record, so a caller who cannot get a
 * value out of the tool must not get it by reading the URI instead -- otherwise
 * a gate like `get-action`'s `includeScript` is one resource read away from
 * being bypassed (VCFO-092).
 *
 * This is about **withholding, not field-set parity**. A resource stays a
 * faithful serialization of the record; it is only the fields a tool withholds
 * *for secrecy* that are reduced here. Fields a tool merely declines to print
 * for brevity -- a package's content listings, say -- are still served, because
 * brevity is not secrecy. Kinds whose tool withholds nothing (workflows,
 * resource elements, packages) therefore have no view at all, and that is
 * deliberate rather than an omission.
 *
 * Two marker shapes, one per medium, both pre-existing in this repo:
 * {@link contentMetadata} for bulky content, and the {@link REDACTED} string
 * for a withheld scalar. A redacted number does become a string, which is the
 * cost of a consumer seeing the same token here as in the tool's text output.
 */

export type ActionResourceView = Omit<Action, "script"> & {
  script?: ContentMetadata;
};

export type SubscriptionResourceView = Omit<Subscription, "constraints"> & {
  constraints?: ContentMetadata;
};

export type ConfigurationResourceView = Omit<ConfigElement, "attributes"> & {
  attributes?: (Omit<ConfigAttribute, "value"> & {
    value?: ConfigAttribute["value"] | typeof REDACTED;
  })[];
};

export type DeploymentResourceView = Deployment;

/**
 * An action's script is summarized rather than served.
 *
 * `get-action` returns only a digest and a length unless the caller passes
 * `includeScript: true`, whose own description says the script "may embed
 * credentials". The full script stays available through that tool call.
 *
 * The digest is taken over the raw script, exactly as `omittedContentSummary`
 * takes it, so the value here and the one in the tool's text agree.
 */
export function actionResourceView(action: Action): ActionResourceView {
  const { script, ...rest } = action;
  const summary = contentMetadata(script);
  return summary === undefined ? rest : { ...rest, script: summary };
}

/**
 * A subscription's constraints are summarized rather than served.
 *
 * Mirrors `get-subscription`'s `includeConstraints` gate, and hashes the same
 * `JSON.stringify(constraints, null, 2)` rendering that tool summarizes, so the
 * two digests match.
 */
export function subscriptionResourceView(
  subscription: Subscription,
): SubscriptionResourceView {
  const { constraints, ...rest } = subscription;
  const summary = contentMetadata(
    constraints === undefined ? undefined : JSON.stringify(constraints, null, 2),
  );
  return summary === undefined ? rest : { ...rest, constraints: summary };
}

/**
 * A configuration attribute the server declares secure is withheld.
 *
 * This is defense in depth rather than a leak being closed: vRO does not return
 * a `SecureString` value in plaintext, which is why `update-configuration` tells
 * callers such values must be supplied fresh. It matters anyway for the reason
 * the tool's own check exists -- {@link isSecureAttributeValue} also catches an
 * attribute declared as something permissive that comes back wrapped in a
 * `secure-string` envelope.
 *
 * Deliberately mirrors `get-configuration`, which redacts secure-typed values
 * only, and NOT the context snapshot, whose `summarizeAttribute` is stricter and
 * redacts every value regardless of type. The two are meant to differ: the
 * snapshot is a durable artifact, this is a live read that matches its tool.
 */
export function configurationResourceView(
  config: ConfigElement,
): ConfigurationResourceView {
  if (!config.attributes) return config as ConfigurationResourceView;
  return {
    ...config,
    attributes: config.attributes.map((attribute) =>
      isSecureAttributeValue(attribute.type, attribute.value)
        ? { ...attribute, value: REDACTED }
        : attribute,
    ),
  };
}

/**
 * A deployment's credential-looking inputs are withheld (VCFO-091).
 *
 * `inputs` carries the values the deployment was requested with, and the record
 * says nothing about which were encrypted, so the key's own name is the only
 * signal -- see src/redaction.ts. Unlike the three views above this one keys off
 * a heuristic rather than a server-supplied type, and it recurses, because an
 * input can be an object carrying a sensitive key of its own.
 */
export function deploymentResourceView(
  deployment: Deployment,
): DeploymentResourceView {
  if (!deployment.inputs) return deployment;
  return {
    ...deployment,
    inputs: redactSensitiveValues(deployment.inputs) as Record<string, unknown>,
  };
}
