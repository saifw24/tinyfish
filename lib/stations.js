// Static reference data (station names + National Rail CRS codes). Not fares.
export const STATIONS = [
  ["London Euston","EUS"],["London Kings Cross","KGX"],["London Paddington","PAD"],["London Waterloo","WAT"],
  ["London St Pancras International","STP"],["London Liverpool Street","LST"],["London Victoria","VIC"],
  ["London Marylebone","MYB"],["London Bridge","LBG"],["London Charing Cross","CHX"],
  ["Manchester Piccadilly","MAN"],["Manchester Victoria","MCV"],["Manchester Airport","MIA"],
  ["Birmingham New Street","BHM"],["Birmingham International","BHI"],["Liverpool Lime Street","LIV"],
  ["Leeds","LDS"],["Sheffield","SHF"],["Bristol Temple Meads","BRI"],["Bristol Parkway","BPW"],
  ["Edinburgh Waverley","EDB"],["Glasgow Central","GLC"],["Glasgow Queen Street","GLQ"],
  ["Newcastle","NCL"],["York","YRK"],["Nottingham","NOT"],["Leicester","LEI"],["Derby","DBY"],
  ["Cardiff Central","CDF"],["Swansea","SWA"],["Newport (South Wales)","NWP"],["Oxford","OXF"],
  ["Cambridge","CBG"],["Brighton","BTN"],["Southampton Central","SOU"],["Reading","RDG"],
  ["Bath Spa","BTH"],["Exeter St Davids","EXD"],["Plymouth","PLY"],["Norwich","NRW"],["Ipswich","IPS"],
  ["Coventry","COV"],["Crewe","CRE"],["Preston","PRE"],["Lancaster","LAN"],["Carlisle","CAR"],
  ["Stoke-on-Trent","SOT"],["Stafford","STA"],["Wolverhampton","WVH"],["Milton Keynes Central","MKC"],
  ["Northampton","NMP"],["Rugby","RUG"],["Durham","DHM"],["Darlington","DAR"],["Doncaster","DON"],
  ["Peterborough","PBO"],["Lincoln","LCN"],["Hull","HUL"],["Huddersfield","HUD"],["Bradford Interchange","BDI"],
  ["Chester","CTR"],["Wigan North Western","WGN"],["Warrington Bank Quay","WBQ"],["Stockport","SPT"],
  ["Aberdeen","ABD"],["Inverness","INV"],["Dundee","DEE"],["Stirling","STG"],["Perth","PTH"],
  ["Gloucester","GCR"],["Cheltenham Spa","CNM"],["Worcester Shrub Hill","WOS"],["Bournemouth","BMH"],
  ["Salisbury","SAL"],["Winchester","WIN"],["Canterbury West","CBW"],["Guildford","GLD"],
  ["Bangor (Gwynedd)","BNG"],["Holyhead","HHD"],["Shrewsbury","SHR"],["Hereford","HFD"],["Tamworth","TAM"],
];
import DEST from "./destinations.json";

const norm = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
// Only codes I am certain of; everything else is resolved by the agent on the live planner.
const ALIAS = {
  london: null,
  bath: "BTH", bathspastation: "BTH", birmingham: "BHM", bristol: "BRI", brighton: "BTN", brightonstation: "BTN",
  cambridge: "CBG", cambridgestation: "CBG", canterbury: "CBW", cardiff: "CDF", cheltenham: "CNM", chester: "CTR", chesterstation: "CTR",
  coventry: "COV", coventrystation: "COV", durham: "DHM", durhamstation: "DHM", edinburgh: "EDB", exeter: "EXD", glasgow: "GLC",
  guildford: "GLD", guildfordstation: "GLD", huddersfield: "HUD", hull: "HUL", hullstation: "HUL", inverness: "INV", invernessstation: "INV",
  lancaster: "LAN", lancasterstation: "LAN", leeds: "LDS", leedsstation: "LDS", leicester: "LEI", leicesterstation: "LEI",
  liverpool: "LIV", manchester: "MAN", newcastle: "NCL", newcastlecentral: "NCL", nottingham: "NOT", nottinghamstation: "NOT",
  norwich: "NRW", norwichstation: "NRW", oxford: "OXF", oxfordstation: "OXF", plymouth: "PLY", plymouthstation: "PLY",
  reading: "RDG", readingstation: "RDG", sheffield: "SHF", sheffieldstation: "SHF", southampton: "SOU", swansea: "SWA", swanseastation: "SWA",
  york: "YRK", yorkstation: "YRK", aberdeen: "ABD", crewe: "CRE", derby: "DBY", derbystation: "DBY", doncaster: "DON", doncasterstation: "DON",
  ipswich: "IPS", peterborough: "PBO", peterboroughstation: "PBO", preston: "PRE", prestonstation: "PRE", stirling: "STG", stockport: "SPT",
  winchester: "WIN", wolverhampton: "WVH", gloucester: "GCR", lincoln: "LCN", northampton: "NMP", miltonkeynes: "MKC",
  londonkingscross: "KGX", londonstpancras: "STP", londonfenchurchstreet: "FST", londonblackfriars: "BFR", londoncannonstreet: "CST",
  stokeontrent: "SOT", watfordjunction: "WFJ", bradfordinterchange: "BDI", manchesterairport: "MIA",
};

// Every name offered in the pickers: built-in stations first, then your CSV destinations.
export const STATION_NAMES = new Set(STATIONS.map(([n]) => n));
export const PLACES = [...new Set([...STATIONS.map(([n]) => n), ...DEST])];

export function resolvePlace(name) {
  const n = norm(name);
  if (!n) return null;
  const st = STATIONS.find(([nm, c]) => norm(nm) === n || c.toLowerCase() === n);
  if (st) return { name: st[0], code: st[1] };
  const canon = PLACES.find((p) => norm(p) === n);
  if (!canon) return null;
  const code = ALIAS[n];
  if (code) return { name: canon, code };
  return { name: canon, code: null }; // the agent resolves the station on the live planner
}
export const placeId = (p) => p.code || `n:${norm(p.name)}`;
