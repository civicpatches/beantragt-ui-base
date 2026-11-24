import { readJurisdictionSettings } from '~~/casework-layer/server/utils/jurisdiction-settings-proxy';

export default defineEventHandler(event => readJurisdictionSettings(event, 'embed'));
