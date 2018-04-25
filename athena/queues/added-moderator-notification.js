// @flow
const debug = require('debug')('athena:queue:added-moderator-notification');
import Raven from 'shared/raven';
import { getCommunityById } from '../models/community';
import { storeNotification } from '../models/notification';
import { storeUsersNotifications } from '../models/usersNotifications';
import { getUsers } from '../models/user';
import { fetchPayload } from '../utils/payloads';
import isEmail from 'validator/lib/isEmail';
import { sendAddedModeratorNotificationQueue } from 'shared/bull/queues';
import type { AddedModeratorNotificationJobData, Job } from 'shared/bull/types';

export default async (job: Job<AddedModeratorNotificationJobData>) => {
  const { moderatorId, communityId, userId } = job.data;
  debug(`added user to community ${communityId}`);

  const [actor, context, entity] = await Promise.all([
    fetchPayload('USER', userId),
    fetchPayload('COMMUNITY', communityId),
    fetchPayload('USER', moderatorId),
  ]);

  const eventType = 'ADDED_MODERATOR';

  // construct a new notification record to either be updated or stored in the db
  const nextNotificationRecord = Object.assign(
    {},
    {
      event: eventType,
      actors: [actor, entity],
      context,
      entities: [context],
    }
  );
  // update or store a record in the notifications table, returns a notification
  const updatedNotification = await storeNotification(nextNotificationRecord);

  // get all the user data for the owners
  const recipients = await getUsers([moderatorId]);

  // only get owners with emails
  const filteredRecipients = recipients.filter(user => isEmail(user.email));

  // for each owner, create a notification for the app
  const usersNotificationPromises = filteredRecipients.map(recipient =>
    storeUsersNotifications(updatedNotification.id, recipient.id)
  );

  // for each owner,send an email
  const community = await getCommunityById(communityId);

  return await Promise.all([
    ...usersNotificationPromises, // update or store usersNotifications in-app
  ]).catch(err => {
    debug('❌ Error in job:\n');
    debug(err);
    Raven.captureException(err);
  });
};
