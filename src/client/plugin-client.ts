import type { ListOptions, VroPlugin, VroPluginList } from "../types.js";
import { matchesFilter, normalizeFilter } from "./filter.js";
import { parseAttrs } from "./attrs.js";
import type { VroHttpClient } from "./core.js";
import { getAllVroPages } from "./pagination.js";

/** vRO `link`/`attributes` list entry, as served by VCF Automation 9.x. */
interface AttributePluginItem {
  attributes?: { name: string; value: string }[];
}

/**
 * Flat plugin descriptor served by the vRO embedded in vRA 8.x, whose
 * `GET /vco/api/plugins` answers `{ plugins: [...], total }` rather than the
 * `link`/`attributes` envelope. Only the fields mapped onto `VroPlugin` are
 * declared; `buildNumber`, `fileName`, and `logLevel` are not surfaced.
 */
interface FlatPluginItem {
  id?: string;
  moduleName?: string;
  version?: string;
  description?: string;
  enabled?: boolean;
}

type RawPluginItem = AttributePluginItem | FlatPluginItem;

function isAttributeItem(item: RawPluginItem): item is AttributePluginItem {
  return Array.isArray((item as AttributePluginItem).attributes);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fromAttributes(item: AttributePluginItem): VroPlugin {
  const a = parseAttrs(item.attributes);
  return {
    name: a["name"] ?? a["@name"] ?? "",
    displayName: a["displayName"] ?? a["display-name"],
    version: a["version"],
    description: a["description"],
    type: a["type"],
  };
}

function fromFlat(item: FlatPluginItem): VroPlugin {
  return {
    // moduleName is the plugin's vRO module name (e.g. "Library"); the
    // descriptor id is only a fallback for an entry that omits it.
    name: optionalString(item.moduleName) ?? optionalString(item.id) ?? "",
    displayName: undefined,
    version: optionalString(item.version),
    description: optionalString(item.description),
    type: undefined,
    enabled: typeof item.enabled === "boolean" ? item.enabled : undefined,
  };
}

export class PluginClient {
  constructor(private http: VroHttpClient) {}

  async listPlugins(filter?: string, options?: ListOptions): Promise<VroPluginList> {
    const params = new URLSearchParams();
    if (filter) {
      params.set("conditions", `name~${filter}`);
    }
    const needle = normalizeFilter(filter);
    const raw = await getAllVroPages<RawPluginItem>(
      this.http,
      "/plugins",
      params,
      {
        itemKeys: ["link", "plugins"],
        maxItems: options?.limit,
        itemFilter: options?.limit !== undefined && needle
          ? (item) => isAttributeItem(item) || matchesFilter(fromFlat(item).name, needle)
          : undefined,
      },
    );
    // The flat vRA 8 endpoint ignores `conditions` (verified against vRA
    // 8.18.1, where every name filter returned the full inventory), so the
    // filter is applied client-side to flat descriptors as a case-insensitive
    // substring match on the module name. Attribute listings are trusted to
    // have been filtered by the server.
    const mapped = raw.link.map((item) =>
      isAttributeItem(item)
        ? { plugin: fromAttributes(item), flat: false }
        : { plugin: fromFlat(item), flat: true },
    );
    const link: VroPlugin[] = mapped
      .filter(
        ({ plugin, flat }) =>
          !needle || !flat || matchesFilter(plugin.name, needle),
      )
      .map(({ plugin }) => plugin);
    const filteredClientSide =
      needle !== undefined && mapped.some(({ flat }) => flat);
    return {
      // After a client-side filter the server total describes the unfiltered
      // inventory, so report the match count instead.
      ...(options?.limit === undefined
        ? { total: filteredClientSide ? link.length : (raw.total ?? link.length) }
        : raw.total !== undefined ? { total: raw.total } : {}),
      link,
      ...(raw.truncated ? { truncated: true } : {}),
      ...(raw.limited ? { limited: true } : {}),
    };
  }
}
