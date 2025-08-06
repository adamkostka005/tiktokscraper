import { createPlaywrightRouter, Dataset } from 'crawlee';
import { Actor } from 'apify';

export const router = createPlaywrightRouter();

router.addDefaultHandler(async ({ page, request, log }) => {
    log.info('--- LOADING ADS ---');
    log.info(`Visiting: ${request.url}`);

    const input = await Actor.getInput();
    const maxResults = input?.maximum_results;
    const allAds = new Map();

    let loadMoreVisible = true;
    let attempts = 0;

    while (loadMoreVisible && allAds.size < maxResults && attempts < 50) {
        await page.waitForSelector('.ad_card', { timeout: 10000 });

        const newAds = await page.$$eval('.ad_card', (cards) => {
            return cards.map((card) => {
                const name = card.querySelector('.ad_info_text')?.textContent?.trim() ?? null;
                const details = card.querySelectorAll('.ad_item_value');
                const firstShown = details[0]?.textContent?.trim() ?? null;
                const lastShown = details[1]?.textContent?.trim() ?? null;
                const uniqueUsers = details[2]?.textContent?.trim() ?? null;
                const relativeLink = card.querySelector('.link')?.getAttribute('href') ?? null;
                const adLink = relativeLink ? 'https://library.tiktok.com' + relativeLink : null;

                return {
                    advertiser: name,
                    first_shown: firstShown,
                    last_shown: lastShown,
                    unique_users: uniqueUsers,
                    ad_link: adLink,
                };
            });
        });

        const adsBefore = allAds.size;

        for (const ad of newAds) {
            if (ad.ad_link && !allAds.has(ad.ad_link)) {
                allAds.set(ad.ad_link, ad);
                if (allAds.size >= maxResults) {
                    log.info(`--- ${maxResults} ADS LOADED ---`);
                    break;
                }
            }
        }

        if (allAds.size >= maxResults) break;

        const loadMore = await page.$('.loading_more_text');
        if (loadMore) {
            log.info('--- LOADING MORE ---');

            try {
                await loadMore.scrollIntoViewIfNeeded();
                await page.evaluate(el => el.click(), loadMore);
                log.info('--- WAITING 5 SECS ---');
                await page.waitForTimeout(5000);

                const cardsNow = await page.$$eval('.ad_card', (cards) => cards.length);
                if (cardsNow <= adsBefore) {
                    log.warning('--- NO NEW ADS ---');
                    break;
                }

            } catch (err) {
                log.warning('--- ERROR', { error: err });
                break;
            }
        } else {
            log.info('--- NO MORE ADS ---');
            loadMoreVisible = false;
        }

        attempts++;
    }

    const browser = page.context().browser();

if (input?.scrape_details) {
    for (const adLink of allAds.keys()) {
        log.info(`Visiting: ${adLink}`);

        const newPage = await browser.newPage();
        try {
            await newPage.goto(adLink, { waitUntil: 'domcontentloaded' });
            log.info('--- LOADING ---');
            await newPage.waitForTimeout(10000);
            log.info(`Scraping: ${adLink}`);
            await newPage.waitForSelector('.ad_detail_module_container', { timeout: 15000 });

            const adDetails = await newPage.evaluate(() => {
                const adId = document.querySelector('.ad_unique_identifier_text')?.textContent?.trim() ?? null;
                const getItemValue = (index) =>
                    document.querySelector(`.ad_detail_module_container .ad_detail_module_item:nth-child(${index + 1}) .item_value`)?.textContent?.trim() ?? null;

                const uniqueViews = getItemValue(2);
                const targetAudienceSize = document.querySelector('.ad_target_audience_size_value')?.textContent?.trim() ?? null;

                const additional = {};
                const addRows = document.querySelectorAll('.targeting_additional_parameters_table_row');
                addRows.forEach(row => {
                    const key = row.querySelector('td:first-child span')?.textContent?.trim();
                    const value = row.cells[1]?.textContent?.trim();
                    if (key && value) additional[key] = value;
                });

                const locationRows = Array.from(document.querySelectorAll('.locations-summary + .target_table tbody tr'));
                const locationData = {};
                locationRows.forEach(tr => {
                    const cells = Array.from(tr.cells);
                    const country = cells[1]?.textContent?.trim();
                    const uniq = cells[2]?.querySelector('.table_row_title')?.textContent?.trim() ?? null;
                    if (country && uniq) locationData[country] = uniq;
                });

                const container = document.querySelector('.ad_detail_module_container');

                return {
                    adId,
                    uniqueViews,
                    targetAudienceSize,
                    additional,
                    locationData,
                    debugHTML: !adId || !container ? container?.innerHTML ?? null : null
                };
            });

            const ad = allAds.get(adLink);
            if (ad) {
                ad.ad_id = adDetails.adId ?? '-';
                ad.detail_unique_users = adDetails.uniqueViews ?? '-';
                ad.detail_target_audience_size = adDetails.targetAudienceSize ?? '-';
                ad.detail_additional_parameters = adDetails.additional ?? {};
                ad.detail_locations = adDetails.locationData ?? {};

                if (adDetails.debugHTML) {
                    log.warning(`No detail data scraped for ${adLink}, but page loaded. Here's what was found:`, {
                        debugHTML: adDetails.debugHTML
                    });
                }
            }

        } catch (err) {
            log.warning(`Failed to open or scrape page: ${adLink}`, { error: err.message });
        }

        }

        await newPage.close();
    }

    await Dataset.pushData([...allAds.values()]);
    log.info(`--- ${allAds.size} ADS SAVED ---`);
});