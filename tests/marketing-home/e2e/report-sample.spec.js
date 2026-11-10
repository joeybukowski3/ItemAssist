const { test, expect, horizontalOverflow } = require("./helpers.js");

const OBSERVED = new Date(Date.UTC(2026, 10, 9));
const RCV_DRYER = 899;
const LIFE = 13;

// Unit age on the observation date for a manufacture month, using the same day-count basis as the report.
const ageAt = (year, month, endOfMonth) => {
  const day = endOfMonth ? new Date(Date.UTC(year, month, 0)) : new Date(Date.UTC(year, month - 1, 1));
  return (OBSERVED - day) / 86400000 / 365.25;
};
const acv = (rcv, age) => rcv * (1 - Math.min(age / LIFE, 1));
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const range = (a, b, digits) => {
  const x = a.toFixed(digits);
  const y = b.toFixed(digits);
  return x === y ? x : x + " to " + y;
};

// GE's Appliance Manufacture Date Code Chart (months and the recent years of each year letter), as read from GE's page.
const GE_MONTHS = { A: 1, D: 2, F: 3, G: 4, H: 5, L: 6, M: 7, R: 8, S: 9, T: 10, V: 11, Z: 12 };
const GE_YEARS = { A: [2025, 2013], D: [2026, 2014], F: [2015, 2003], G: [2016, 2004], H: [2017, 2005], L: [2018, 2006], M: [2019, 2007], R: [2020, 2008], S: [2021, 2009], T: [2022, 2010], V: [2023, 2011], Z: [2024, 2012] };
// GE's stated manufacture window for GFD65ESSNWW: December 2019 to August 2023.
const inWindow = (year, month) => (year > 2019 || (year === 2019 && month >= 12)) && (year < 2023 || (year === 2023 && month <= 8));

test("the report is a fixed-date three-case document, free of the retired fictional demonstration", async ({ page }) => {
  // A different "today" must not change the report: the date is fixed, not generated from the visitor's clock.
  await page.clock.install({ time: new Date("2031-03-15T12:00:00Z") });
  await page.goto("/report");
  await expect(page.locator("h1")).toHaveText("Sample Research Report");
  const text = await page.locator("main").textContent();
  expect(text).toContain("Report date: November 9, 2026");
  expect(text).not.toMatch(/2031|Published (January|February|March)/);
  await expect(page.locator(".report-published-date")).toHaveCount(0);
  expect(text).not.toMatch(/fictional|IA-DEMO|demonstration only|Items Researched|Research Comparisons|Average Documented Age|21 High-Confidence|1 Limited-Confidence|22 items/i);
  for (const id of ["case-tv", "case-fridge", "case-dryer", "sources"]) await expect(page.locator("#" + id), id).toHaveCount(1);
  await expect(page.locator("main h2.rp-h2")).toHaveText([
    "How to read this report",
    "Summary findings",
    "Case 1: Samsung 55-inch television",
    "Case 2: Samsung refrigerator",
    "Case 3: GE dryer age research",
    "Sources and limits of this sample"
  ]);
  await expect(page.locator('a[href="/assets/ItemAssist-Sample-Research-Report.pdf"]')).toBeVisible();
  await expect(page.locator('a[href="/#consultation"]').first()).toBeAttached();
});

test("the television case separates documented, third-party and unresolved evidence and keeps price policy visible", async ({ page }) => {
  await page.goto("/report");
  const tv = page.locator("#case-tv");
  await expect(tv.locator(".rc-orig-model")).toHaveText("Samsung QN55Q80AAFXZA");
  await expect(tv.locator(".rc-src--third")).toHaveText(/RTINGS/);
  const card = page.locator("#case-tv").locator("xpath=ancestor::div[contains(@class,'rp-wrap')]");
  await expect(card).toContainText("Third-party measurement");
  await expect(card).toContainText("Not established");
  await expect(card).toContainText("Unresolved");
  await expect(card).toContainText("$827.95");
  await expect(card).toContainText("$509.99");
  await expect(card).toContainText("$399.99");
  await expect(card).toContainText("QN55QN80FAFXZA");
  await expect(card).toContainText("comparable value");
  await expect(card).toContainText("it is not treated here as a regular market price");
  await expect(card).toContainText("ACV: not calculated");
  await expect(card).toContainText("client input required rather than invented");
  for (const price of ["$699.99", "$899.99", "$1,199.99", "$1,099.99", "$899.99", "$1,299.99", "$1,999.99"]) await expect(card).toContainText(price);
});

test("the refrigerator ACV example shows every input and the arithmetic is correct", async ({ page }) => {
  await page.goto("/report");
  const rcv = 1899.99;
  const age = 6;
  const depreciation = age / LIFE;
  const amount = Math.round(rcv * depreciation * 100) / 100;
  const result = Math.round((rcv - amount) * 100) / 100;
  expect(result).toBe(1023.07);
  const table = page.locator("#case-fridge").locator("xpath=ancestor::div[contains(@class,'rp-wrap')]").locator("table.rp-table").last();
  for (const label of ["Replacement value (RCV)", "Age evidence", "Age used in this example", "Method", "Useful life", "Condition adjustment", "Depreciation", "Calculated ACV"]) {
    await expect(table.locator("tbody th", { hasText: label }).first(), label).toBeAttached();
  }
  await expect(table).toContainText("6.0 ÷ 13 = " + (depreciation * 100).toFixed(2) + "%");
  await expect(table).toContainText("$" + amount.toFixed(2));
  await expect(table).toContainText("$1,899.99 − $" + amount.toFixed(2) + " = $" + result.toLocaleString("en-US", { minimumFractionDigits: 2 }));
  await expect(table).toContainText("Assumed, illustrative");
  await expect(table).toContainText("Client input");
});

test("the dryer age table follows from GE's manufacture window and date-code chart", async ({ page }) => {
  await page.goto("/report");
  const section = page.locator("#case-dryer");
  await expect(section).toContainText("December 2019 to August 2023");
  await expect(section).toContainText("September 2023 to present");
  await expect(section).toContainText("No serial number was available for this example");
  await expect(section).toContainText("A nameplate serial number would name one month");
  await expect(section).not.toContainText(/serial (number )?(is|was|reads?) [A-Z]{2}\d/i);

  // The month letters as stated, in GE's order.
  await expect(section).toContainText("A January, D February, F March, G April, H May, L June, M July, R August, S September, T October, V November, Z December");
  await expect(section).toContainText("“GA” means April 2001 or April 2013");

  // Which year letters are possible follows mechanically from the window and GE's chart.
  const possible = Object.entries(GE_YEARS)
    .filter(([, years]) => Object.values(GE_MONTHS).some((month) => years.some((year) => inWindow(year, month))))
    .map(([letter]) => letter)
    .sort();
  expect(possible).toEqual(["M", "R", "S", "T", "V"]);

  const letterRows = section.locator("table", { hasText: "Possible for GFD65ESSNWW?" }).locator("tbody tr");
  await expect(letterRows.nth(0).locator("th")).toHaveText("M");
  await expect(letterRows.nth(0).locator("td").nth(1)).toContainText("December 2019 only");
  await expect(letterRows.nth(4).locator("td").nth(1)).toContainText("January to August 2023 only");
  await expect(letterRows.nth(5).locator("th")).toHaveText("Z, A, D");
  await expect(letterRows.nth(5).locator("td").nth(1)).toContainText("No.");
  for (const [rowIndex, letter] of [[0, "M"], [1, "R"], [2, "S"], [3, "T"], [4, "V"]]) {
    await expect(letterRows.nth(rowIndex).locator("td").nth(0), letter).toContainText(GE_YEARS[letter][0] + ", " + GE_YEARS[letter][1]);
  }

  // Age, depreciation and ACV per possible year letter, recomputed here.
  const windows = { M: [2019, 12, 12], R: [2020, 1, 12], S: [2021, 1, 12], T: [2022, 1, 12], V: [2023, 1, 8] };
  const ageRows = section.locator("table", { hasText: "Whole window, no serial" }).locator("tbody tr");
  let index = 0;
  for (const [letter, [year, firstMonth, lastMonth]] of Object.entries(windows)) {
    const oldest = ageAt(year, firstMonth, false);
    const youngest = ageAt(year, lastMonth, true);
    const row = ageRows.nth(index);
    await expect(row.locator("th"), letter).toHaveText(new RegExp("^" + letter + " "));
    await expect(row.locator("td").nth(0), letter).toHaveText(range(youngest, oldest, 1) + " years");
    if (letter !== "M") {
      const dep = range((youngest / LIFE) * 100, (oldest / LIFE) * 100, 1).replace(/(\d+\.\d)(?= |$)/g, "$1%");
      await expect(row.locator("td").nth(1), letter).toHaveText(dep);
    }
    await expect(row.locator("td").nth(2), letter).toHaveText(money(acv(RCV_DRYER, oldest)) + " to " + money(acv(RCV_DRYER, youngest)));
    index += 1;
  }
  // Whole window: youngest possible unit (end of August 2023) to oldest (December 2019).
  const whole = ageRows.nth(5).locator("td");
  const youngestAll = ageAt(2023, 8, true);
  const oldestAll = ageAt(2019, 12, false);
  await expect(whole.nth(0)).toHaveText(range(youngestAll, oldestAll, 1) + " years");
  await expect(whole.nth(2)).toHaveText(money(acv(RCV_DRYER, oldestAll)) + " to " + money(acv(RCV_DRYER, youngestAll)));

  // The "same letter, two readings" example: R as 2020 against R as 2008 (past the 13-year life).
  const misread = section.locator("table", { hasText: "Reading of the letter R" }).locator("tbody tr");
  const age2008Old = ageAt(2008, 1, false);
  const age2008Young = ageAt(2008, 12, true);
  expect(age2008Young).toBeGreaterThan(LIFE);
  await expect(misread.nth(1).locator("td").nth(0)).toHaveText(range(age2008Young, age2008Old, 1) + " years");
  await expect(misread.nth(1).locator("td").nth(1)).toContainText("100%");
  await expect(misread.nth(1).locator("td").nth(2)).toContainText("$0");
});

test("successor and price claims in the dryer case are bounded by what was verified", async ({ page }) => {
  await page.goto("/report");
  const section = page.locator("#case-dryer");
  await expect(section).toContainText("108 specification fields");
  await expect(section).toContainText("101 are identical");
  await expect(section).toContainText("Eight differ");
  await expect(section).toContainText("A GE-issued specification sheet for the successor was not retrieved");
  await expect(section).toContainText("$899.00");
  await expect(section).toContainText("GE list price $1,249.00");
  await expect(section).toContainText("Availability not confirmed");
  await expect(section).toContainText("$419 to $678");
  await expect(section.locator(".rp-callout")).toHaveCount(2);
  // The ACV disclaimer appears under each ACV example.
  const disclaimers = page.locator("main").getByText("Item Assist does not determine depreciation, final ACV, coverage or settlement");
  expect(await disclaimers.count()).toBeGreaterThanOrEqual(3);
});

test("the summary shows reported against researched age, a verified total and an ACV that states what is missing", async ({ page }) => {
  await page.goto("/report");
  const summary = page.locator("#summary");
  const ages = summary.locator("table").nth(0);
  await expect(ages.locator("thead th")).toHaveText(["Item", "Reported age", "Researched age", "Age status", "Documented market price"]);
  const cells = async (row) => ages.locator("tbody tr").nth(row).locator("th, td").allTextContents();
  const tv = await cells(0);
  expect(tv.slice(1, 4)).toEqual(["2021", "2021, model year", "Model Year Confirmed"]);
  const fridge = await cells(1);
  expect(fridge.slice(1, 4)).toEqual(["Not provided", "Not established", "Age Evidence Needed"]);
  const dryer = await cells(2);
  expect(dryer.slice(1, 4)).toEqual(["2025", "December 2019 to August 2023, model production window", "Reported Age Requires Review"]);
  // The total is the sum of the three documented prices.
  const prices = [tv, fridge, dryer].map((row) => Number(row[4].match(/^\$([\d,]+\.\d\d)/)[1].replace(/,/g, "")));
  expect(prices).toEqual([899.99, 1899.99, 899]);
  const total = Math.round(prices.reduce((a, b) => a + b, 0) * 100) / 100;
  expect(total).toBe(3698.98);
  await expect(ages.locator("tbody tr").nth(3)).toContainText("$3,698.98, three items");
  await expect(summary).not.toContainText(/Age Verified/);

  // ACV by item: television unresolved, refrigerator and dryer illustrative, sum matches the stated partial range.
  const acvTable = summary.locator("table").nth(1);
  await expect(acvTable.locator("tbody tr").last().locator("td")).toHaveText(["Unresolved", "$1,023.07, illustrative", "$419 to $678, illustrative range"]);
  await expect(acvTable.locator("tbody th", { hasText: "Useful life" }).locator("xpath=..").locator("td").first()).toContainText("None supported");
  const observed = Date.UTC(2026, 10, 9);
  const ageAt = (year, month, endOfMonth) => (observed - (endOfMonth ? Date.UTC(year, month, 0) : Date.UTC(year, month - 1, 1))) / 86400000 / 365.25;
  const low = 1023.07 + acv(899, ageAt(2019, 12, false));
  const high = 1023.07 + acv(899, ageAt(2023, 8, true));
  await expect(summary).toContainText(`$1,023.07 + $419 to $678 = ${money(low)} to ${money(high)}`);
  await expect(summary).toContainText("The television is excluded because no supported television useful life exists");
  await expect(summary).toContainText("the refrigerator’s age is assumed");
  await expect(summary).not.toContainText(/verified aggregate|Verification Needed|Discrepancy/);
  await expect(summary).toContainText("not a verified claim valuation");
});

test("the dryer's reported 2025 is shown as a discrepancy against GE's window, with its effect on the ACV", async ({ page }) => {
  await page.goto("/report");
  const section = page.locator("#case-dryer");
  const table = section.locator("table", { hasText: "Reported age against the research" });
  await expect(table.locator("tbody tr").nth(0)).toContainText("2025, in the sample submission");
  await expect(table.locator("tbody tr").nth(1)).toContainText("December 2019 to August 2023");
  await expect(table.locator("tbody tr").nth(2)).toContainText("GE lists no production of this model after August 2023");
  await expect(table.locator("tbody tr").nth(2)).toContainText("the letter A");
  await expect(table.locator("tbody tr").nth(3)).toContainText("A dryer built in the window could have been bought or installed in 2025");
  await expect(table.locator("tbody tr").nth(5)).toContainText("Reported Age Requires Review");
  await expect(table.locator("tbody tr").nth(2)).toContainText("No conclusion is drawn about the accuracy of the report");
  await expect(table.locator("tbody tr").nth(5)).toContainText("a serial number or other appropriate documentation is needed to resolve the original unit’s age");
  // The documented window is kept, not rewritten to fit the reported age.
  await expect(section).not.toContainText(/2019 to 2021|2019[–-]2021/);
  // 2025 as a build year, from the same inputs and day count as the rest of the report.
  const old = ageAt(2025, 1, false);
  const young = ageAt(2025, 12, true);
  const effect = (await table.locator("tbody tr").nth(6).textContent()).replace(/\s+/g, " ");
  expect(effect).toContain(`${range(young, old, 1)} years`);
  expect(effect).toContain(`${money(acv(RCV_DRYER, old))} to ${money(acv(RCV_DRYER, young))}`);
  expect(acv(RCV_DRYER, young)).toBeGreaterThan(acv(RCV_DRYER, ageAt(2023, 8, true)));
  expect(effect).toContain("GE’s window supports $419 to $678");
});

test("the refrigerator is not marked age-verified and its ACV is labelled as an assumed age; price wording follows the policy", async ({ page }) => {
  await page.goto("/report");
  const fridge = page.locator("#case-fridge").locator("xpath=ancestor::div[contains(@class,'rp-wrap')]");
  await expect(fridge).toContainText("Not provided in the sample submission");
  await expect(fridge).toContainText("No serial analysis is shown or implied, and none is invented");
  await expect(fridge).toContainText("Age Evidence Needed. The original model was identified and researched, but no serial number or other sufficient unit-specific evidence was available");
  await expect(fridge).toContainText("No age verification is claimed");
  await expect(fridge).toContainText("Illustrative ACV (assumed age)");
  await expect(fridge).not.toContainText("age-supported");
  const main = await page.locator("main").innerText();
  expect(main).toContain("Documented market price");
  expect(main).not.toMatch(/Average Market Price/i);
  // No promotional label sits on the comparison headings or tags; the qualification stays in the notes.
  await expect(page.locator(".rc-event, .rc-tag--sale")).toHaveCount(0);
  await expect(page.locator("#case-tv thead .rc-meta").nth(1)).toHaveText("Documented at Best Buy · Nov 9, 2026");
  await expect(page.locator("main")).toContainText("during Black Friday and Holiday Deal promotions");
  await expect(page.locator("main")).toContainText("have not been re-verified since");
  await expect(page.locator("main")).toContainText("list prices and retailer crossed-out prices are not substituted", { ignoreCase: true });
  await expect(page.locator("#sources")).toContainText("none is marked Age Verified");
});

test("sources are external, resolvable-looking links, and the report makes no testimonial or outcome claims", async ({ page }) => {
  await page.goto("/report");
  const links = await page.locator("#sources a").evaluateAll((nodes) => nodes.map((a) => ({ href: a.href, rel: a.rel })));
  expect(links.length).toBeGreaterThanOrEqual(25);
  for (const link of links) {
    expect(link.href).toMatch(/^https:\/\//);
    expect(link.rel).toContain("noopener");
  }
  const hosts = new Set(links.map((l) => new URL(l.href).hostname));
  for (const host of ["www.bestbuy.com", "www.samsung.com", "news.samsung.com", "www.rtings.com", "products.geappliances.com", "www.homedepot.com", "standards.nsf.org", "www.energystar.gov"]) {
    expect(hosts.has(host), host).toBe(true);
  }
  const text = await page.locator("main").innerText();
  for (const pattern of [/testimonial/i, /\bsavings?\b/i, /\bsaved\b/i, /percent faster/i, /\bguarantee/i, /\bour team\b/i, /\blicensed\b/i, /\bcertified (adjuster|appraiser)/i, /\btrusted by\b/i, /\baward/i]) {
    expect(text, String(pattern)).not.toMatch(pattern);
  }
});

test("the downloadable sample is a two-page PDF that links back to the consultation and report", async ({ request }) => {
  const response = await request.get("/assets/ItemAssist-Sample-Research-Report.pdf");
  expect(response.status()).toBe(200);
  // The local static test server sends a generic type; the bytes below are what matter, and Vercel serves .pdf as application/pdf.
  expect(response.headers()["content-type"]).toMatch(/pdf|octet-stream/);
  const body = await response.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  expect(body.length).toBeGreaterThan(50000);
  const raw = body.toString("latin1");
  expect((raw.match(/\/Type\s*\/Page(?![s\w])/g) || []).length).toBe(2);
  for (const target of ["https://itemassist.com/#consultation", "https://itemassist.com/report", "https://itemassist.com/?consult=research_request#consultation"]) {
    expect(raw, target).toContain(target);
  }
});

test("the report layout holds: no overflow, tables stack on narrow screens, comparison keeps all three candidates", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/report");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await expect(page.locator("#case-tv thead .rc-model")).toHaveText(["Samsung QN55QN70H", "Samsung QN55QN80H", "Samsung QN55S90H"]);
  await expect(page.locator("#case-fridge thead .rc-model")).toHaveText(["Samsung RF32CG5B30SR", "Samsung RF28R7201SR", "Samsung RF29BB8600QL"]);
  const narrow = testInfo.project.use.viewport.width <= 700;
  const display = await page.locator("table.rp-table--stack thead").first().evaluate((el) => getComputedStyle(el).display);
  expect(display === "none").toBe(narrow);
  for (const box of await page.locator(".rc, .rp-card").all()) {
    const rect = await box.boundingBox();
    expect(rect.x + rect.width).toBeLessThanOrEqual(testInfo.project.use.viewport.width + 0.5);
  }
  expect(errors).toEqual([]);
});
