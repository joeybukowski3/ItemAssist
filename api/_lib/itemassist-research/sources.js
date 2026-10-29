/**
 * The hosts ItemAssist Research will accept as a price or specification source, with each host's class and display name.
 * A copy of the research engine's registry (a test checks every golden source is accepted and the host count). An unknown host is
 * never a citation: its link is dropped, and any price resting on it is withheld by the projection.
 */

const SOURCE_CLASSES = Object.freeze(["MANUFACTURER", "RETAILER", "REVIEW", "TECH_DATABASE", "MARKETPLACE"]);
const FIRST_PARTY_CLASSES = Object.freeze(["MANUFACTURER", "RETAILER"]);

// Host, source class, display name, and the storefront hosts that count as the registered domain itself. Generated from the research
// engine (scripts/itemassist-research-export.mjs there writes it and checks it for drift); edit only outside the markers.
// BEGIN GENERATED REGISTRY (scripts/itemassist-research-export.mjs in the research engine; do not edit by hand)
const REGISTRY = Object.freeze([
  ["samsung.com", "MANUFACTURER", "Samsung"],
  ["lg.com", "MANUFACTURER", "LG"],
  ["sony.com", "MANUFACTURER", "Sony"],
  ["tcl.com", "MANUFACTURER", "TCL"],
  ["hisense-usa.com", "MANUFACTURER", "Hisense"],
  ["hisense.com", "MANUFACTURER", "Hisense"],
  ["vizio.com", "MANUFACTURER", "Vizio"],
  ["insigniaproducts.com", "MANUFACTURER", "Insignia"],
  ["geappliances.com", "MANUFACTURER", "GE Appliances"],
  ["ge.com", "MANUFACTURER", "GE"],
  ["whirlpool.com", "MANUFACTURER", "Whirlpool"],
  ["frigidaire.com", "MANUFACTURER", "Frigidaire"],
  ["kitchenaid.com", "MANUFACTURER", "KitchenAid"],
  ["bosch-home.com", "MANUFACTURER", "Bosch"],
  ["subzero-wolf.com", "MANUFACTURER", "Sub-Zero"],
  ["maytag.com", "MANUFACTURER", "Maytag"],
  ["bestbuy.com", "RETAILER", "Best Buy"],
  ["homedepot.com", "RETAILER", "The Home Depot"],
  ["lowes.com", "RETAILER", "Lowe’s"],
  ["costco.com", "RETAILER", "Costco"],
  ["samsclub.com", "RETAILER", "Sam’s Club"],
  ["abt.com", "RETAILER", "Abt"],
  ["crutchfield.com", "RETAILER", "Crutchfield"],
  ["ajmadison.com", "RETAILER", "AJ Madison"],
  ["appliancesconnection.com", "RETAILER", "Appliances Connection"],
  ["target.com", "RETAILER", "Target"],
  ["walmart.com", "RETAILER", "Walmart"],
  ["bhphotovideo.com", "RETAILER", "B&H"],
  ["pcrichard.com", "RETAILER", "P.C. Richard & Son"],
  ["newegg.com", "RETAILER", "Newegg"],
  ["microcenter.com", "RETAILER", "Micro Center"],
  ["electronicexpress.com", "RETAILER", "Electronic Express"],
  ["yaleappliance.com", "RETAILER", "Yale Appliance"],
  ["brandsmartusa.com", "RETAILER", "BrandsMart USA"],
  ["bjs.com", "RETAILER", "BJ’s Wholesale Club"],
  ["plessers.com", "RETAILER", "Plesser’s Appliances"],
  ["appliancefactory.com", "RETAILER", "Appliance Factory"],
  ["townappliance.com", "RETAILER", "Town Appliance"],
  ["applianceleaders.com", "RETAILER", "Appliance Leaders"],
  ["rtings.com", "TECH_DATABASE", "RTINGS"],
  ["displayspecifications.com", "TECH_DATABASE", "DisplaySpecifications"],
  ["tftcentral.co.uk", "TECH_DATABASE", "TFTCentral"],
  ["notebookcheck.net", "TECH_DATABASE", "Notebookcheck"],
  ["cnet.com", "REVIEW", "CNET"],
  ["techradar.com", "REVIEW", "TechRadar"],
  ["tomsguide.com", "REVIEW", "Tom’s Guide"],
  ["theverge.com", "REVIEW", "The Verge"],
  ["whathifi.com", "REVIEW", "What Hi-Fi?"],
  ["pcmag.com", "REVIEW", "PCMag"],
  ["consumerreports.org", "REVIEW", "Consumer Reports"],
  ["reviewed.com", "REVIEW", "Reviewed"],
  ["digitaltrends.com", "REVIEW", "Digital Trends"],
  ["engadget.com", "REVIEW", "Engadget"],
  ["zdnet.com", "REVIEW", "ZDNET"],
  ["forbes.com", "REVIEW", "Forbes"],
  ["residentialsystems.com", "REVIEW", "Residential Systems"],
  ["theshortcut.com", "REVIEW", "The Shortcut"],
  ["amazon.com", "MARKETPLACE", "Amazon"],
  ["ebay.com", "MARKETPLACE", "eBay"],
  ["aliexpress.com", "MARKETPLACE", "AliExpress"],
  ["mercari.com", "MARKETPLACE", "Mercari"],
  ["offerup.com", "MARKETPLACE", "OfferUp"],
]);
const STOREFRONT_LABELS = Object.freeze(["shop","us","m","products"]);
const EXACT_HOST_ONLY = Object.freeze(["brandsmartusa.com","bjs.com","plessers.com","appliancefactory.com","townappliance.com","applianceleaders.com"]);
// END GENERATED REGISTRY

const MAX_URL_CHARS = 300;
// Only the registered domain and its own storefront hosts count: a marketplace, community, seller or forum subdomain can carry third-party content.
const hostMatches = (host, domain) => host === domain || (!EXACT_HOST_ONLY.includes(domain) && STOREFRONT_LABELS.some((label) => host === label + "." + domain));
const bareHost = (host) => String(host || "").toLowerCase().replace(/^www\./, "");

/** Registry entry for a host, or null. */
function classifyHost(host) {
  const clean = bareHost(host);
  const entry = REGISTRY.find(([domain]) => hostMatches(clean, domain));
  return entry ? { domain: entry[0], sourceClass: entry[1], sourceName: entry[2] } : null;
}

/** The URL reduced to origin and path (no query, fragment, credentials or port), with its registry entry; null when it is not an acceptable https link. */
function safeSourceUrl(value) {
  if (typeof value !== "string" || !value || value.length > MAX_URL_CHARS || /[\u0000-\u001f\u007f\s]/.test(value)) return null;
  let url;
  try { url = new URL(value); } catch (error) { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const known = classifyHost(url.hostname);
  return known ? { url: url.origin + url.pathname, host: bareHost(url.hostname), ...known } : null;
}

module.exports = { REGISTRY, SOURCE_CLASSES, FIRST_PARTY_CLASSES, classifyHost, safeSourceUrl, bareHost };
