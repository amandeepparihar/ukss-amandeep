import { createLogger, type Logger } from "../../lib/logger";
import { nanoid } from "nanoid";
import { config } from "../../config";
import { prisma } from "../../lib/prisma";
import { emailService } from "../../lib/email";
import * as fs from "fs/promises";
import * as path from "path";
import { existsSync, mkdirSync } from "fs";
import archiver from "archiver";
import { createWriteStream } from "fs";
import { fetch } from "undici";
import querystring from 'querystring';
import { prepareFruugoOrderDataForInsertion } from "../../lib/fruugo/fruugo-order-data.utils";

const logger = createLogger('fruugo-order-service');


/**
 * Get Fruugo orders from API
 * 
 * Converted from CakePHP function: get_fruugo_orders($static_from_time = '', $static_end_time = '')
 * 
 * @param staticFromTime - Optional static from time (Unix timestamp as string)
 * @param staticEndTime - Optional static end time (Unix timestamp as string)
 * @returns Promise that resolves when the operation completes
 */
export async function getFruugoOrders(staticFromTime?: string, staticEndTime?: string) {
    const executionId = nanoid(10);
    const log = logger.child({ executionId });

    log.info({ staticFromTime, staticEndTime }, 'Starting get_fruugo_orders function');

    try {
        const catalogDirectory = config.DIR_FS_CATALOG ?? '';
        // Setup directories
        const feedFileDirectory = catalogDirectory + config.DIR_FS_FRUUGO;

        if (!feedFileDirectory) {
            throw new Error('DIR_FS_FRUUGO is not configured. Please set the DIR_FS_FRUUGO environment variable.');
        }

        // Clean and normalize the directory path (remove quotes, normalize slashes)
        const normalizedDirectory = feedFileDirectory.trim().replace(/['"]/g, '').replace(/\/$/, '');
        
        // Resolve directory path relative to project root
        // In Docker, the project root is mounted at /app (working directory)
        // Paths starting with / but not /app should be resolved relative to project root
        const projectRoot = process.cwd(); // This will be /app in Docker, or project root locally
        let resolvedDirectory: string;
        
        if (path.isAbsolute(normalizedDirectory)) {
            // If it's an absolute path but not under /app (in Docker) or project root (locally),
            // treat it as relative to project root
            if (normalizedDirectory.startsWith('/') && !normalizedDirectory.startsWith(projectRoot)) {
                // Remove leading slash and resolve relative to project root
                const relativePath = normalizedDirectory.substring(1);
                resolvedDirectory = path.resolve(projectRoot, relativePath);
            } else {
                resolvedDirectory = path.normalize(normalizedDirectory);
            }
        } else {
            // Relative path - resolve relative to project root
            resolvedDirectory = path.resolve(projectRoot, normalizedDirectory);
        }

        await ensureDirectoryExists(resolvedDirectory, log);

        // Activity log file details
        const activityLogFile = 'fruugo_activity';

        // Write activity log
        log.info('Activity log file details: ', { activityLogFile });
        log.info('Starting get_fruugo_orders function');

        // Check if feed file already exists
        const feedFileName = 'fruugo_orders_feed.xml';
        const feedFilePath = path.join(resolvedDirectory, feedFileName);
        const absoluteFeedFilePath = path.resolve(feedFilePath);

        log.info({ 
            originalDirectory: feedFileDirectory,
            normalizedDirectory,
            resolvedDirectory,
            feedFilePath,
            absoluteFeedFilePath 
        }, 'File path configuration');

        if (await fileExists(absoluteFeedFilePath)) {
            log.warn('Order feed file already exists, archiving existing files');
            log.error('# The Order feed is already present in the directory. Please remove the file and try again.');
            log.error('# get_fruugo_orders failed.');
            log.error('# get_fruugo_orders Job Failed File already present.');

            // Archive existing XML files
            await archiveExistingFeedFiles(resolvedDirectory);

            return { success: false, message: 'Order feed file already exists, archiving existing files' };
        } else {
            // Prepare data for cURL request
            log.info('Prepare the data for cURL request:');

            const apiId = config.Fruugo_API_ID;
            const apiPassword = config.Fruugo_API_Password;
            const requestUrlTemplate = config.Fruugo_API_REQUEST_URL;

            if (!apiId || !apiPassword || !requestUrlTemplate) {
                throw new Error('Fruugo API credentials or request URL not configured');
            }

            // Determine time range
            let fromTime: string;
            let toTime: string;

            if (staticFromTime && staticEndTime) {
                // Validate static times
                const fromTimeTrimmed = staticFromTime.trim();
                const endTimeTrimmed = staticEndTime.trim();

                if (!fromTimeTrimmed || !endTimeTrimmed) {
                    throw new Error('Please pass both the from time and end time.');
                }

                const currentDateTime = Math.floor(Date.now() / 1000);
                const fromTimeNum = parseInt(fromTimeTrimmed, 10);
                const endTimeNum = parseInt(endTimeTrimmed, 10);

                // Validate numeric and date range
                if (isNaN(fromTimeNum) || isNaN(endTimeNum)) {
                    throw new Error('Invalid time range. Please check the from time is either greater than end time OR you are passing future date values.');
                }

                const fromDate = new Date(fromTimeNum * 1000);
                const endDate = new Date(endTimeNum * 1000);

                // Check if dates are valid (not 1970)
                if (fromDate.getFullYear() === 1970 || endDate.getFullYear() === 1970) {
                    throw new Error('Invalid time range. Please check the from time is either greater than end time OR you are passing future date values.');
                }

                // Validate time constraints
                if (fromTimeNum >= currentDateTime || endTimeNum > currentDateTime || fromTimeNum >= endTimeNum) {
                    throw new Error('Invalid time range. Please check the from time is either greater than end time OR you are passing future date values.');
                }

                // Convert to Fruugo API format (Y-m-d\TH:i:s)
                fromTime = formatDateTimeForFruugo(fromTimeNum);
                toTime = formatDateTimeForFruugo(endTimeNum);

                if (!fromTime || !toTime) {
                    throw new Error('There is something wrong with the from time and end time. Please check the values.');
                }
            } else if ((staticFromTime && !staticEndTime) || (!staticFromTime && staticEndTime)) {
                throw new Error('Please pass both the from time and end time.');
            } else {
                // Fetch last order date from database
                const lastOrderDate = await prisma.moMarketplaceOrder.findFirst({
                    where: {
                        moStoreName: 'Fruugo',
                        moUkssOrderId: {
                            not: null,
                        },
                    },
                    select: {
                        moOrderPlaceDate: true,
                    },
                    orderBy: {
                        moOrderPlaceDate: 'desc',
                    },
                });

                const lastTime = lastOrderDate?.moOrderPlaceDate;

                if (lastTime) {
                    // Start date: 1 day before last order date
                    const fromDate = new Date(lastTime);
                    fromDate.setDate(fromDate.getDate() - 1);
                    fromTime = formatDateTimeForFruugo(Math.floor(fromDate.getTime() / 1000));
                } else {
                    // If no last order, use a default (e.g., 7 days ago)
                    const defaultDate = new Date();
                    defaultDate.setDate(defaultDate.getDate() - 7);
                    fromTime = formatDateTimeForFruugo(Math.floor(defaultDate.getTime() / 1000));
                }

                // End date: current time + 2 hours (GMT)
                const toDate = new Date();
                toDate.setHours(toDate.getHours() + 2);
                toTime = formatDateTimeForFruugo(Math.floor(toDate.getTime() / 1000));
            }

            // Build URL (PHP sprintf style: %s placeholders)
            // Handle both %s placeholders and {from}/{to} placeholders
            let url = requestUrlTemplate;
            if (url.includes('%s')) {
                // Replace first %s with fromTime, second %s with toTime
                url = url.replace('%s', fromTime).replace('%s', toTime);
            } else {
                // Fallback to {from} and {to} placeholders
                url = url.replace('{from}', fromTime).replace('{to}', toTime);
            }

            // Log API details
            log.info({ apiId, url }, 'API details');
            log.info({ apiPassword, url }, 'API details');

            // Make API request
            const response = await makeFruugoApiRequest(url, apiId, apiPassword, undefined, log);

            const ordersData = response.data;
            const httpCode = response.httpCode;
            const curlErrorMsg = response.curlErrorMsg;

            if (curlErrorMsg || httpCode !== 200) {
                log.error({ httpCode, curlErrorMsg }, 'API request failed');
                log.error(`# API Response code: ${httpCode}\n`);
                log.error(`# API Response error: ${curlErrorMsg || 'Unknown error'}\n`);
                log.error('# get_fruugo_orders Job API Failed. Due to error in the API request.');
                // Send error email
                await emailService.sendErrorNotification({
                    subject: 'Error: Fruugo Order API Request Failed',
                    errorMessage: `There is error in the API request${curlErrorMsg ? `: ${curlErrorMsg}` : ''}.`,
                    module: 'fruugo-order-service',
                    context: {
                        url,
                        httpCode,
                        curlErrorMsg,
                        executionId,
                    },
                });

                throw new Error(`Fruugo API request failed: ${curlErrorMsg || `HTTP ${httpCode}`}`);
            } else {
                // Save feed file
                log.info({ absoluteFeedFilePath, fileSize: ordersData.length }, 'Writing feed file');
                await fs.writeFile(absoluteFeedFilePath, ordersData, 'utf8');
                
                // Verify file was saved successfully
                try {
                    const fileStats = await fs.stat(absoluteFeedFilePath);
                    log.info({ 
                        absoluteFeedFilePath,
                        fileSize: fileStats.size,
                        created: fileStats.birthtime,
                        modified: fileStats.mtime
                    }, 'Feed file saved and verified successfully');
                } catch (error) {
                    log.error({ error, absoluteFeedFilePath }, 'Failed to verify file was saved');
                    throw new Error(`File was not saved successfully. Path: ${absoluteFeedFilePath}`);
                }

                if (httpCode === 200) {
                    log.info(`# API Response code: ${httpCode}`);
                    log.info('# API Run Successfully.');
                    log.info('# get_fruugo_orders Job completed.');

                    // Call function to prepare the data for insertion
                    await prepareFruugoOrderDataForInsertion(log);
                }
            }
        }

        // Log cron run end
        log.info('END: get_fruugo_orders');

        log.info('get_fruugo_orders function completed successfully');
        return { success: true, message: 'Fruugo orders fetched successfully' };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error({ error, errorMessage }, 'Failed to get Fruugo orders');
        await emailService.sendErrorNotification({
            subject: 'Error: Get Fruugo Orders Failed',
            errorMessage: `Hi Team,<br>Please check the error mentioned below:<br><b>Module Name:</b> Get Fruugo Orders <br><b>File:</b> apps/api/src/modules/fruugo/fruugo-order-service.ts<br> <b>Error:</b> ${errorMessage}`,
            module: 'fruugo-order-service',
            context: {
                error: errorMessage,
                staticFromTime,
                staticEndTime,
            },
        });

        return { success: false, message: errorMessage };
    }
}

/**
 * Format Unix timestamp to Fruugo API date format (Y-m-d\TH:i:s)
 */
function formatDateTimeForFruugo(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * Make Fruugo API request with basic authentication
 */
export async function makeFruugoApiRequest(
    url: string,
    apiId: string,
    apiPassword: string,
    fields?: Record<string, string>,
    logger?: Logger
): Promise<{ data: string; httpCode: number; curlErrorMsg: string }> {
    const log = logger || createLogger('fruugo-api-request');

    try {
        // Create basic auth header
        const credentials = Buffer.from(`${apiId}:${apiPassword}`).toString('base64');

        // FIX: Akamai CDN (Fruugo's WAF) blocks requests that look like bot traffic.
        // A browser-like User-Agent + proper Accept headers are required to pass bot detection,
        // especially for POST endpoints (custom User-Agent alone was insufficient for POST).
        // Ref: Akamai references #18.51691702.1774242002.4f9615d, #18.51691702.1774258493.93df458 (2026-03-23)
        const browserHeaders = {
            'Authorization': `Basic ${credentials}`,
            'Accept': 'application/xml',
            'Accept-Language': 'en-US,en;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
            'Connection': 'keep-alive',
        };

        let response;

        if(fields) {
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    ...browserHeaders,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: querystring.stringify(fields),
            })
        }else{
            response = await fetch(url, {
                method: 'GET',
                headers: browserHeaders,
            })
        }

        const httpCode = response.status;
        let data = '';
        let curlErrorMsg = '';

        if (response.ok) {
            data = await response.text();
        } else {
            curlErrorMsg = `HTTP ${httpCode}: ${response.statusText}`;
            const errorText = await response.text().catch(() => '');
            if (errorText) {
                curlErrorMsg += ` - ${errorText}`;
            }
        }

        return { data, httpCode, curlErrorMsg };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error({ error, url }, 'Failed to make Fruugo API request');
        return {
            data: '',
            httpCode: 0,
            curlErrorMsg: errorMessage,
        };
    }
}

/**
 * Archive existing XML feed files to zip
 */
async function archiveExistingFeedFiles(feedFileDirectory: string, logger?: Logger): Promise<void> {
    const log = logger || createLogger('fruugo-archive');

    try {
        // Check if archive directory exists
        const archiveDir = path.join(feedFileDirectory, 'Archive');
        await ensureDirectoryExists(archiveDir, log);

        // Create zip file name with timestamp (1 day ago format: y_m_d_H_i_s)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const zipFileName = `order_feed_${formatDateForZip(yesterday)}.zip`;
        const zipFilePath = path.join(archiveDir, zipFileName);

        // Find all XML files in feed directory
        const files = await fs.readdir(feedFileDirectory);
        const xmlFiles = files.filter(file => file.endsWith('.xml'));

        if (xmlFiles.length === 0) {
            log.info('No XML files to archive');
            return;
        }

        // Create zip archive
        return new Promise((resolve, reject) => {
            const output = createWriteStream(zipFilePath);
            const archive = archiver('zip', {
                zlib: { level: 9 }, // Maximum compression
            });

            output.on('close', async () => {
                log.info({ zipFilePath, fileCount: xmlFiles.length }, 'Zip archive created successfully');

                // Delete XML files after archiving
                for (const xmlFile of xmlFiles) {
                    const xmlFilePath = path.join(feedFileDirectory, xmlFile);
                    try {
                        await fs.unlink(xmlFilePath);
                        log.debug({ xmlFile }, 'Deleted XML file after archiving');
                    } catch (error) {
                        log.error({ error, xmlFile }, 'Failed to delete XML file after archiving');
                    }
                }

                resolve();
            });

            archive.on('error', (error) => {
                log.error({ error }, 'Failed to create zip archive');
                reject(error);
            });

            archive.pipe(output);

            // Add XML files to archive
            for (const xmlFile of xmlFiles) {
                const xmlFilePath = path.join(feedFileDirectory, xmlFile);
                archive.file(xmlFilePath, { name: xmlFile });
            }

            archive.finalize();
        });
    } catch (error) {
        log.error({ error }, 'Failed to archive existing feed files');
        throw error;
    }
}

/**
 * Format date for zip file name (y_m_d_H_i_s format)
 */
function formatDateForZip(date: Date): string {
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}_${month}_${day}_${hours}_${minutes}_${seconds}`;
}

/**
 * Ensure directory exists, create if it doesn't
 */
async function ensureDirectoryExists(directory: string | undefined, logger?: Logger): Promise<void> {
    if (!directory) {
        throw new Error('Directory is not configured');
    }

    if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: true, mode: 0o775 });
        if (logger) {
            logger.debug({ directory }, 'Created directory');
        }
    }
}

/**
 * Check if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}