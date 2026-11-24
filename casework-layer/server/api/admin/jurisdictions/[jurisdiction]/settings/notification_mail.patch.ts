import { saveJurisdictionSettings } from '~~/casework-layer/server/utils/jurisdiction-settings-proxy';

export default defineEventHandler(event => saveJurisdictionSettings(event, 'notification_mail'));
