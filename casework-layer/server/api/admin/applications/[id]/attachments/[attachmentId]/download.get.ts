import { downloadApplicationAttachment } from '~~/casework-layer/server/utils/application-attachment-download';

export default defineEventHandler(event => downloadApplicationAttachment(event, 'download'));
