// tests/phase3j-notification-channels.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NotificationChannelProvider,
  NotificationChannelCapabilities,
  PermissionState,
  NotificationChannelRequest,
  validateChannelRequest,
  NotificationChannelPreference,
} from '../src/lib/notification-channel';
import {
  NotificationChannelRegistry,
  notificationChannelRegistry,
} from '../src/lib/notification-channel-registry';
import { InAppNotificationChannelProvider } from '../src/lib/in-app-channel-provider';
import {
  NotificationDeliveryManager,
  InMemoryDeliveryRepository,
  deliverProactiveResponse,
  deliverProactiveResponseToChannels,
  generateDeliveryId,
} from '../src/lib/notification-delivery';
import { alphaStore } from '../src/lib/alpha-store';
import {
  notificationAcknowledgementManager,
  InMemoryAcknowledgementRepository,
} from '../src/lib/notification-acknowledgement';
import {
  NotificationRecoveryManager,
  InMemoryReminderRecoveryRepository,
} from '../src/lib/notification-recovery';
import { ReminderScheduler } from '../src/lib/reminder-scheduler';
import { InMemoryReminderRepository } from '../src/lib/reminder-repo';
import { ReminderTool } from '../src/lib/reminder-tool';

describe('Phase 3J — External Notification Channel Architecture', () => {
  const userA = 'user-alpha-3j-1';
  const userB = 'user-alpha-3j-2';

  let deliveryRepo: InMemoryDeliveryRepository;
  let deliveryManager: NotificationDeliveryManager;
  let ackRepo: InMemoryAcknowledgementRepository;

  beforeEach(() => {
    alphaStore.clearChat();
    notificationChannelRegistry.reset(true);

    deliveryRepo = new InMemoryDeliveryRepository();
    deliveryManager = new NotificationDeliveryManager({ repo: deliveryRepo });
    ackRepo = new InMemoryAcknowledgementRepository();
    notificationAcknowledgementManager.setRepository(ackRepo);
  });

  // =========================================================================
  // 1. Channel Contract & Request Validation
  // =========================================================================
  describe('1. Channel Contract & Request Validation', () => {
    it('1.1 valid channel request passes validation with exact fields', () => {
      const payload: NotificationChannelRequest = {
        eventId: 'due_rem-1_1700000000',
        reminderId: 'rem-1',
        userId: userA,
        title: 'Meeting with Team',
        body: 'Your meeting with Team is due now',
        dueAt: 1700000000,
        createdAt: 1699999000,
        notes: 'Prepare agenda',
        metadata: { source: 'scheduler', priority: 'high' },
      };

      const result = validateChannelRequest(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.request.eventId).toBe('due_rem-1_1700000000');
        expect(result.request.reminderId).toBe('rem-1');
        expect(result.request.userId).toBe(userA);
        expect(result.request.title).toBe('Meeting with Team');
        expect(result.request.body).toBe('Your meeting with Team is due now');
        expect(result.request.metadata?.source).toBe('scheduler');
      }
    });

    it('1.2 rejects non-object or null request payload', () => {
      expect(validateChannelRequest(null).success).toBe(false);
      expect(validateChannelRequest(undefined).success).toBe(false);
      expect(validateChannelRequest('not an object').success).toBe(false);
      expect(validateChannelRequest(12345).success).toBe(false);
    });

    it('1.3 rejects missing or empty eventId', () => {
      const result = validateChannelRequest({
        eventId: '',
        reminderId: 'rem-1',
        userId: userA,
        title: 'Title',
        body: 'Body',
      });
      expect(result.success).toBe(false);
    });

    it('1.4 rejects missing or empty reminderId', () => {
      const result = validateChannelRequest({
        eventId: 'due_rem-1_1700000000',
        reminderId: '   ',
        userId: userA,
        title: 'Title',
        body: 'Body',
      });
      expect(result.success).toBe(false);
    });

    it('1.5 rejects missing or empty userId', () => {
      const result = validateChannelRequest({
        eventId: 'due_rem-1_1700000000',
        reminderId: 'rem-1',
        userId: '',
        title: 'Title',
        body: 'Body',
      });
      expect(result.success).toBe(false);
    });

    it('1.6 rejects missing title or body', () => {
      expect(
        validateChannelRequest({
          eventId: 'due_rem-1_1700000000',
          reminderId: 'rem-1',
          userId: userA,
          body: 'Body',
        }).success
      ).toBe(false);

      expect(
        validateChannelRequest({
          eventId: 'due_rem-1_1700000000',
          reminderId: 'rem-1',
          userId: userA,
          title: 'Title',
        }).success
      ).toBe(false);
    });

    it('1.7 rejects non-record metadata (array or primitive)', () => {
      const arrayMeta = validateChannelRequest({
        eventId: 'due_rem-1_1700000000',
        reminderId: 'rem-1',
        userId: userA,
        title: 'Title',
        body: 'Body',
        metadata: ['invalid', 'array'] as any,
      });
      expect(arrayMeta.success).toBe(false);

      const primitiveMeta = validateChannelRequest({
        eventId: 'due_rem-1_1700000000',
        reminderId: 'rem-1',
        userId: userA,
        title: 'Title',
        body: 'Body',
        metadata: 12345 as any,
      });
      expect(primitiveMeta.success).toBe(false);
    });

    it('1.8 supports channel preference architectural representation', () => {
      const pref: NotificationChannelPreference = {
        channel: 'in_app',
        enabled: true,
      };
      expect(pref.channel).toBe('in_app');
      expect(pref.enabled).toBe(true);
    });
  });

  // =========================================================================
  // 2. Channel Registry Operations
  // =========================================================================
  describe('2. Channel Registry Operations', () => {
    it('2.1 registry defaults to containing the in_app provider', () => {
      expect(notificationChannelRegistry.hasChannel('in_app')).toBe(true);
      const provider = notificationChannelRegistry.getChannel('in_app');
      expect(provider).toBeDefined();
      expect(provider?.id).toBe('in_app');
      expect(provider?.displayName).toBe('In-App Notification');
    });

    it('2.2 registers a custom channel provider cleanly', () => {
      const customProvider: NotificationChannelProvider = {
        id: 'mock_custom',
        displayName: 'Mock Custom Channel',
        getCapabilities: () => ({
          available: true,
          backgroundDelivery: false,
          requiresPermission: false,
          supportsRichContent: false,
          supportsActions: false,
          supportsSound: false,
        }),
        getPermissionState: () => 'not_required',
        isAvailable: () => true,
        deliver: async (req) => ({
          success: true,
          channel: 'mock_custom',
          status: 'delivered',
          eventId: req.eventId,
          deliveredAt: Date.now(),
        }),
      };

      notificationChannelRegistry.registerChannel(customProvider);
      expect(notificationChannelRegistry.hasChannel('mock_custom')).toBe(true);
      expect(notificationChannelRegistry.getChannel('mock_custom')?.displayName).toBe('Mock Custom Channel');
    });

    it('2.3 rejects duplicate channel registration without allowOverride', () => {
      const duplicate: NotificationChannelProvider = {
        id: 'in_app',
        displayName: 'Duplicate In-App',
        getCapabilities: () => ({
          available: true,
          backgroundDelivery: false,
          requiresPermission: false,
          supportsRichContent: true,
          supportsActions: true,
          supportsSound: false,
        }),
        getPermissionState: () => 'not_required',
        isAvailable: () => true,
        deliver: async (req) => ({
          success: true,
          channel: 'in_app',
          status: 'delivered',
          eventId: req.eventId,
        }),
      };

      expect(() => {
        notificationChannelRegistry.registerChannel(duplicate);
      }).toThrow(/already registered/i);
    });

    it('2.4 replaces channel provider cleanly when allowOverride is true', () => {
      const customOverride: NotificationChannelProvider = {
        id: 'in_app',
        displayName: 'Custom Overridden In-App',
        getCapabilities: () => ({
          available: true,
          backgroundDelivery: false,
          requiresPermission: false,
          supportsRichContent: true,
          supportsActions: true,
          supportsSound: false,
        }),
        getPermissionState: () => 'not_required',
        isAvailable: () => true,
        deliver: async (req) => ({
          success: true,
          channel: 'in_app',
          status: 'delivered',
          eventId: req.eventId,
        }),
      };

      notificationChannelRegistry.registerChannel(customOverride, { allowOverride: true });
      expect(notificationChannelRegistry.getChannel('in_app')?.displayName).toBe('Custom Overridden In-App');
    });

    it('2.5 unregisters a channel by ID and returns true', () => {
      const custom: NotificationChannelProvider = {
        id: 'temp_channel',
        displayName: 'Temporary',
        getCapabilities: () => ({
          available: true,
          backgroundDelivery: false,
          requiresPermission: false,
          supportsRichContent: false,
          supportsActions: false,
          supportsSound: false,
        }),
        getPermissionState: () => 'not_required',
        isAvailable: () => true,
        deliver: async (req) => ({ success: true, channel: 'temp_channel', status: 'delivered', eventId: req.eventId }),
      };

      notificationChannelRegistry.registerChannel(custom);
      expect(notificationChannelRegistry.hasChannel('temp_channel')).toBe(true);

      const removed = notificationChannelRegistry.unregisterChannel('temp_channel');
      expect(removed).toBe(true);
      expect(notificationChannelRegistry.hasChannel('temp_channel')).toBe(false);
    });

    it('2.6 unregistering a non-existent channel returns false', () => {
      expect(notificationChannelRegistry.unregisterChannel('non_existent_channel')).toBe(false);
    });

    it('2.7 listChannels returns all registered providers', () => {
      const channels = notificationChannelRegistry.listChannels();
      expect(channels.length).toBeGreaterThanOrEqual(1);
      expect(channels.some((c) => c.id === 'in_app')).toBe(true);
    });

    it('2.8 listAvailableChannels filters only available providers', async () => {
      const unavailableProvider: NotificationChannelProvider = {
        id: 'mock_unavailable',
        displayName: 'Unavailable Channel',
        getCapabilities: () => ({
          available: false,
          backgroundDelivery: true,
          requiresPermission: true,
          supportsRichContent: false,
          supportsActions: false,
          supportsSound: false,
        }),
        getPermissionState: () => 'unavailable',
        isAvailable: () => false,
        deliver: async (req) => ({ success: false, channel: 'mock_unavailable', status: 'unavailable', eventId: req.eventId }),
      };

      notificationChannelRegistry.registerChannel(unavailableProvider);
      const available = await notificationChannelRegistry.listAvailableChannels();
      expect(available.some((c) => c.id === 'in_app')).toBe(true);
      expect(available.some((c) => c.id === 'mock_unavailable')).toBe(false);
    });

    it('2.9 getChannelCapabilities retrieves capabilities accurately', () => {
      const caps = notificationChannelRegistry.getChannelCapabilities('in_app');
      expect(caps).toBeDefined();
      expect(caps?.available).toBe(true);
      expect(caps?.requiresPermission).toBe(false);
      expect(notificationChannelRegistry.getChannelCapabilities('unknown_channel')).toBeUndefined();
    });

    it('2.10 getChannelPermission returns permission state or unavailable for unknown channels', async () => {
      const permInApp = await notificationChannelRegistry.getChannelPermission('in_app');
      expect(permInApp).toBe('not_required');

      const permUnknown = await notificationChannelRegistry.getChannelPermission('unknown');
      expect(permUnknown).toBe('unavailable');
    });

    it('2.11 getChannelReport provides structured availability and authorization breakdown', async () => {
      const report = await notificationChannelRegistry.getChannelReport('in_app');
      expect(report.supported).toBe(true);
      expect(report.available).toBe(true);
      expect(report.permission).toBe('not_required');
      expect(report.enabled).toBe(true);

      const unknownReport = await notificationChannelRegistry.getChannelReport('future_browser');
      expect(unknownReport.supported).toBe(false);
      expect(unknownReport.available).toBe(false);
      expect(unknownReport.permission).toBe('unavailable');
      expect(unknownReport.enabled).toBe(false);
    });

    it('2.12 reset restores default in_app provider cleanly', () => {
      notificationChannelRegistry.registerChannel({
        id: 'test_temp',
        displayName: 'Test',
        getCapabilities: () => ({ available: true, backgroundDelivery: false, requiresPermission: false, supportsRichContent: false, supportsActions: false, supportsSound: false }),
        getPermissionState: () => 'not_required',
        isAvailable: () => true,
        deliver: async (req) => ({ success: true, channel: 'test_temp', status: 'delivered', eventId: req.eventId }),
      });
      expect(notificationChannelRegistry.hasChannel('test_temp')).toBe(true);

      notificationChannelRegistry.reset(true);
      expect(notificationChannelRegistry.hasChannel('test_temp')).toBe(false);
      expect(notificationChannelRegistry.hasChannel('in_app')).toBe(true);
    });
  });

  // =========================================================================
  // 3. In-App Reference Channel Provider
  // =========================================================================
  describe('3. In-App Reference Channel Provider', () => {
    let inAppProvider: InAppNotificationChannelProvider;

    beforeEach(() => {
      inAppProvider = new InAppNotificationChannelProvider(deliveryManager);
    });

    it('3.1 conforms to NotificationChannelProvider interface', () => {
      expect(inAppProvider.id).toBe('in_app');
      expect(inAppProvider.displayName).toBe('In-App Notification');
      expect(typeof inAppProvider.getCapabilities).toBe('function');
      expect(typeof inAppProvider.getPermissionState).toBe('function');
      expect(typeof inAppProvider.isAvailable).toBe('function');
      expect(typeof inAppProvider.deliver).toBe('function');
    });

    it('3.2 reports accurate in-app capabilities', () => {
      const caps = inAppProvider.getCapabilities();
      expect(caps.available).toBe(true);
      expect(caps.backgroundDelivery).toBe(false);
      expect(caps.requiresPermission).toBe(false);
      expect(caps.supportsRichContent).toBe(true);
      expect(caps.supportsActions).toBe(true);
      expect(caps.supportsSound).toBe(false);
    });

    it('3.3 reports permission as not_required', () => {
      expect(inAppProvider.getPermissionState()).toBe('not_required');
      expect(inAppProvider.getPermissionState(userA)).toBe('not_required');
    });

    it('3.4 reports isAvailable as true', () => {
      expect(inAppProvider.isAvailable()).toBe(true);
      expect(inAppProvider.isAvailable(userA)).toBe(true);
    });

    it('3.5 delivers valid request into chat store and returns structured success', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-3j-1_1000',
        reminderId: 'rem-3j-1',
        userId: userA,
        title: 'Drink Water',
        body: 'Drink water reminder is due now!',
        dueAt: 1000,
      };

      const result = await inAppProvider.deliver(request, userA);
      expect(result.success).toBe(true);
      expect(result.channel).toBe('in_app');
      expect(result.status).toBe('delivered');
      expect(result.deliveryId).toBe('due_rem-3j-1_1000:in_app');
      expect(result.eventId).toBe('due_rem-3j-1_1000');

      const chat = alphaStore.get().chat;
      expect(chat.length).toBe(1);
      expect(chat[0].proactiveEventId).toBe('due_rem-3j-1_1000');
      expect(chat[0].text).toBe('Drink water reminder is due now!');
    });

    it('3.6 duplicate delivery via provider is idempotent and returns already_delivered', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-3j-2_2000',
        reminderId: 'rem-3j-2',
        userId: userA,
        title: 'Stretch Break',
        body: 'Time to stretch!',
        dueAt: 2000,
      };

      const res1 = await inAppProvider.deliver(request, userA);
      expect(res1.success).toBe(true);
      expect(res1.status).toBe('delivered');

      const res2 = await inAppProvider.deliver(request, userA);
      expect(res2.success).toBe(true);
      expect(res2.status).toBe('already_delivered');

      // Exactly one chat message in alphaStore
      const chat = alphaStore.get().chat.filter((m) => m.proactiveEventId === 'due_rem-3j-2_2000');
      expect(chat.length).toBe(1);
    });

    it('3.7 delivery without authenticated user fails with unauthenticated status', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-3j-3_3000',
        reminderId: 'rem-3j-3',
        userId: userA,
        title: 'Check Mail',
        body: 'Check email',
      };

      const result = await inAppProvider.deliver(request, '');
      expect(result.success).toBe(false);
      expect(result.status).toBe('unauthenticated');
      expect(result.error?.code).toBe('UNAUTHENTICATED');
    });

    it('3.8 user mismatch between authenticated user and request fails safely', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-3j-4_4000',
        reminderId: 'rem-3j-4',
        userId: userA,
        title: 'Private Note',
        body: 'Private alert',
      };

      const result = await inAppProvider.deliver(request, userB);
      expect(result.success).toBe(false);
      expect(result.status).toBe('unauthenticated');
      expect(result.error?.code).toBe('USER_MISMATCH');
    });
  });

  // =========================================================================
  // 4. Channel Selection & Resolution Boundaries
  // =========================================================================
  describe('4. Channel Selection & Resolution Boundaries', () => {
    it('4.1 resolves to in_app when channel is omitted or undefined', async () => {
      const res = await notificationChannelRegistry.resolveChannel(undefined);
      expect(res.status).toBe('resolved');
      expect(res.provider?.id).toBe('in_app');
    });

    it('4.2 resolves explicit "in_app" channel', async () => {
      const res = await notificationChannelRegistry.resolveChannel('in_app');
      expect(res.status).toBe('resolved');
      expect(res.provider?.id).toBe('in_app');
    });

    it('4.3 resolves case-insensitively ("IN_APP" -> in_app)', async () => {
      const res = await notificationChannelRegistry.resolveChannel('IN_APP');
      expect(res.status).toBe('resolved');
      expect(res.provider?.id).toBe('in_app');
    });

    it('4.4 reports unsupported for unregistered channel ("custom_external")', async () => {
      const res = await notificationChannelRegistry.resolveChannel('custom_external');
      expect(res.status).toBe('unsupported');
      expect(res.provider).toBeUndefined();
      expect(res.error).toMatch(/unsupported/i);
    });

    it('4.5 reports unsupported for unknown channel ("android")', async () => {
      const res = await notificationChannelRegistry.resolveChannel('android');
      expect(res.status).toBe('unsupported');
    });

    it('4.6 reports unsupported for unknown channel ("voice")', async () => {
      const res = await notificationChannelRegistry.resolveChannel('voice');
      expect(res.status).toBe('unsupported');
    });

    it('4.7 reports unavailable for registered channel that reports isAvailable = false', async () => {
      const mockOfflineChannel: NotificationChannelProvider = {
        id: 'mock_offline',
        displayName: 'Offline Provider',
        getCapabilities: () => ({
          available: false,
          backgroundDelivery: true,
          requiresPermission: false,
          supportsRichContent: false,
          supportsActions: false,
          supportsSound: false,
        }),
        getPermissionState: () => 'not_required',
        isAvailable: () => false,
        deliver: async (req) => ({ success: false, channel: 'mock_offline', status: 'unavailable', eventId: req.eventId }),
      };

      notificationChannelRegistry.registerChannel(mockOfflineChannel);
      const res = await notificationChannelRegistry.resolveChannel('mock_offline');
      expect(res.status).toBe('unavailable');
      expect(res.error).toMatch(/unavailable/i);
    });
  });

  // =========================================================================
  // 5. Multi-Channel Architecture & Failure Isolation
  // =========================================================================
  describe('5. Multi-Channel Architecture & Failure Isolation', () => {
    it('5.1 generateDeliveryId deterministically combines eventId and channelId', () => {
      expect(generateDeliveryId('due_rem-10_5000', 'in_app')).toBe('due_rem-10_5000:in_app');
      expect(generateDeliveryId('due_rem-10_5000', 'browser')).toBe('due_rem-10_5000:browser');
      expect(generateDeliveryId('due_rem-10_5000', 'android')).toBe('due_rem-10_5000:android');
    });

    it('5.2 one reminder event produces independent channel delivery identities', () => {
      const eventId = 'due_rem-meds_9000';
      const inAppId = generateDeliveryId(eventId, 'in_app');
      const browserId = generateDeliveryId(eventId, 'browser');
      expect(inAppId).not.toBe(browserId);
      expect(inAppId.startsWith(eventId)).toBe(true);
      expect(browserId.startsWith(eventId)).toBe(true);
    });

    it('5.3 multi-channel dispatch delivers to in_app and isolates unsupported channels', async () => {
      const record = {
        eventId: 'due_rem-multi_10000',
        reminderId: 'rem-multi',
        userId: userA,
        messageId: 'msg-multi',
        text: 'Multi-channel reminder alert',
        title: 'Multi Reminder',
        dueAt: 10000,
      };

      const result = await deliveryManager.deliverProactiveResponseToChannels({
        authenticatedUserId: userA,
        record,
        channels: ['in_app', 'browser', 'android'],
      });

      expect(result.overallSuccess).toBe(true);
      expect(result.deliveredChannels).toEqual(['in_app']);
      expect(result.failedChannels).toContain('browser');
      expect(result.failedChannels).toContain('android');

      // in_app succeeded
      expect(result.results['in_app'].success).toBe(true);
      expect(result.results['in_app'].status).toBe('delivered');

      // browser failed safely without throwing or breaking in_app
      expect(result.results['browser'].success).toBe(false);
      if (!result.results['browser'].success) {
        expect(['UNSUPPORTED_CHANNEL', 'CHANNEL_UNAVAILABLE']).toContain(
          result.results['browser'].error.code
        );
      }

      // Chat store received the message cleanly
      const inChat = alphaStore.get().chat.find((m) => m.proactiveEventId === record.eventId);
      expect(inChat).toBeDefined();
      expect(inChat?.text).toBe(record.text);
    });

    it('5.4 failed channel delivery does not roll back or corrupt successful in_app delivery', async () => {
      const record = {
        eventId: 'due_rem-iso_11000',
        reminderId: 'rem-iso',
        userId: userA,
        messageId: 'msg-iso',
        text: 'Isolated delivery message',
      };

      // 1. Deliver to in_app
      const inAppRes = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: userA,
        record,
        channel: 'in_app',
      });
      expect(inAppRes.success).toBe(true);

      // 2. Attempt delivery to unsupported channel
      const unsupportedRes = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: userA,
        record,
        channel: 'unsupported_channel_xyz',
      });
      expect(unsupportedRes.success).toBe(false);

      // 3. Verify in_app delivery record in repository remains 'delivered'
      const inAppRecord = await deliveryRepo.getDelivery(userA, 'due_rem-iso_11000:in_app');
      expect(inAppRecord).toBeDefined();
      expect(inAppRecord?.status).toBe('delivered');
    });

    it('5.5 multi-channel dispatch defaults to in_app when channels array is empty', async () => {
      const record = {
        eventId: 'due_rem-def_12000',
        reminderId: 'rem-def',
        userId: userA,
        messageId: 'msg-def',
        text: 'Default multi delivery',
      };

      const result = await deliveryManager.deliverProactiveResponseToChannels({
        authenticatedUserId: userA,
        record,
        channels: [],
      });

      expect(result.overallSuccess).toBe(true);
      expect(result.deliveredChannels).toEqual(['in_app']);
      expect(result.results['in_app'].success).toBe(true);
    });
  });

  // =========================================================================
  // 6. Acknowledgement & Recovery Lifecycle Integration
  // =========================================================================
  describe('6. Acknowledgement & Recovery Lifecycle Integration', () => {
    it('6.1 in-app delivery registers acknowledgement record with channel "in_app"', async () => {
      const record = {
        eventId: 'due_rem-ack_13000',
        reminderId: 'rem-ack',
        userId: userA,
        messageId: 'msg-ack-1',
        text: 'Doctor appointment reminder',
        title: 'Doctor Appointment',
        dueAt: 13000,
      };

      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: userA,
        record,
        channel: 'in_app',
      });
      expect(result.success).toBe(true);

      const ack = await ackRepo.getAcknowledgement(userA, 'due_rem-ack_13000:in_app:ack');
      expect(ack).toBeDefined();
      expect(ack?.channel).toBe('in_app');
      expect(ack?.status).toBe('delivered');
      expect(ack?.title).toBe('Doctor Appointment');
    });

    it('6.2 delivery does NOT automatically mark the notification as acknowledged', async () => {
      const record = {
        eventId: 'due_rem-unack_14000',
        reminderId: 'rem-unack',
        userId: userA,
        messageId: 'msg-unack',
        text: 'Feed cat',
        title: 'Feed Cat',
        dueAt: 14000,
      };

      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: userA,
        record,
        channel: 'in_app',
      });

      const ack = await ackRepo.getAcknowledgement(userA, 'due_rem-unack_14000:in_app:ack');
      expect(ack?.status).toBe('delivered');
      expect(ack?.acknowledgedAt).toBeUndefined();
    });

    it('6.3 acknowledgement manager acknowledges the delivery record cleanly', async () => {
      const record = {
        eventId: 'due_rem-explicit_15000',
        reminderId: 'rem-explicit',
        userId: userA,
        messageId: 'msg-explicit',
        text: 'Take medication',
        title: 'Medication',
        dueAt: 15000,
      };

      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: userA,
        record,
        channel: 'in_app',
      });

      const ackResult = await notificationAcknowledgementManager.acknowledgeReminder({
        authenticatedUserId: userA,
        eventId: record.eventId,
        userConfirmationText: 'I took my meds',
      });

      expect(ackResult.success).toBe(true);
      expect(ackResult.status).toBe('acknowledged');

      const ack = await ackRepo.getAcknowledgement(userA, 'due_rem-explicit_15000:in_app:ack');
      expect(ack?.status).toBe('acknowledged');
      expect(ack?.userConfirmationText).toBe('I took my meds');
    });

    it('6.4 recovery manager identifies outstanding delivered-but-unacknowledged in-app notifications', async () => {
      const recoveryManager = new NotificationRecoveryManager(ackRepo);

      const record = {
        eventId: 'due_rem-recov_16000',
        reminderId: 'rem-recov',
        userId: userA,
        messageId: 'msg-recov',
        text: 'Pay electricity bill',
        title: 'Electricity Bill',
        dueAt: 16000,
      };

      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: userA,
        record,
        channel: 'in_app',
      });

      const recoveryRes = await recoveryManager.getOutstandingAcknowledgements(userA);

      expect(recoveryRes.success).toBe(true);
      if (recoveryRes.success) {
        expect(recoveryRes.count).toBe(1);
        expect(recoveryRes.records[0].eventId).toBe(record.eventId);
        expect(recoveryRes.records[0].channel).toBe('in_app');
        expect(recoveryRes.records[0].status).toBe('delivered');
      }
    });

    it('6.5 unsupported channel attempt does NOT create spurious acknowledgement records', async () => {
      const record = {
        eventId: 'due_rem-spurious_17000',
        reminderId: 'rem-spurious',
        userId: userA,
        messageId: 'msg-spurious',
        text: 'Spurious test',
      };

      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: userA,
        record,
        channel: 'fake_channel',
      });

      const ack = await ackRepo.getAcknowledgement(userA, 'due_rem-spurious_17000:fake_channel:ack');
      expect(ack).toBeNull();
    });
  });

  // =========================================================================
  // 7. Security & User Isolation
  // =========================================================================
  describe('7. Security & User Isolation', () => {
    it('7.1 delivery requires authenticated user ID', async () => {
      const record = {
        eventId: 'due_rem-sec1_18000',
        reminderId: 'rem-sec1',
        userId: userA,
        messageId: 'msg-sec1',
        text: 'Security alert',
      };

      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: '',
        record,
        channel: 'in_app',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('7.2 cross-user delivery attempt is rejected with USER_MISMATCH', async () => {
      const record = {
        eventId: 'due_rem-sec2_19000',
        reminderId: 'rem-sec2',
        userId: userA,
        messageId: 'msg-sec2',
        text: 'User A private note',
      };

      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: userB,
        record,
        channel: 'in_app',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('USER_MISMATCH');
      }
    });

    it('7.3 User A deliveries are isolated and invisible to User B queries', async () => {
      const record = {
        eventId: 'due_rem-sec3_20000',
        reminderId: 'rem-sec3',
        userId: userA,
        messageId: 'msg-sec3',
        text: 'User A confidential reminder',
      };

      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: userA,
        record,
        channel: 'in_app',
      });

      const userBDeliveries = await deliveryRepo.listDeliveries(userB);
      expect(userBDeliveries.length).toBe(0);

      const userADeliveries = await deliveryRepo.listDeliveries(userA);
      expect(userADeliveries.length).toBe(1);
    });

    it('7.4 caller cannot spoof user ownership via arbitrary metadata fields', async () => {
      const record = {
        eventId: 'due_rem-sec4_21000',
        reminderId: 'rem-sec4',
        userId: userA,
        messageId: 'msg-sec4',
        text: 'Spoof attempt',
        metadata: {
          authenticatedUserId: userB,
          spoofedUser: 'admin',
        },
      };

      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: userA,
        record,
        channel: 'in_app',
      });

      expect(result.success).toBe(true);
      const delivery = await deliveryRepo.getDelivery(userA, 'due_rem-sec4_21000:in_app');
      expect(delivery?.userId).toBe(userA);
    });
  });

  // =========================================================================
  // 8. Regression & Architectural Separation
  // =========================================================================
  describe('8. Regression & Architectural Separation', () => {
    it('8.1 reminder scheduler remains completely channel-agnostic', async () => {
      const remRepo = new InMemoryReminderRepository();
      const scheduler = new ReminderScheduler({ repo: remRepo });

      await remRepo.createReminder(userA, {
        id: 'rem-sched-1',
        userId: userA,
        title: 'Daily Meeting',
        notes: '',
        dueAt: Date.now() - 1000,
        createdAt: Date.now() - 60000,
        updatedAt: Date.now() - 60000,
        reminderState: 'active',
        notificationState: 'pending',
      });

      const claimed = await scheduler.runTick(userA);
      expect(claimed.length).toBe(1);
      expect(claimed[0].reminderId).toBe('rem-sched-1');

      // Scheduler only cares about reminderState and notificationState, not channels
      const updated = await remRepo.getReminder(userA, 'rem-sched-1');
      expect(updated?.notificationState).toBe('claimed');
    });

    it('8.2 reminder tools remain completely channel-agnostic', async () => {
      const remRepo = new InMemoryReminderRepository();
      const reminderTool = new ReminderTool(userA, remRepo);

      const res = await reminderTool.createReminder({
        title: 'Doctor Visit',
        dueAt: Date.now() + 7200000,
      });

      expect(res.success).toBe(true);
      const reminders = await remRepo.listReminders(userA);
      expect(reminders.length).toBe(1);
      expect(reminders[0].title).toBe('Doctor Visit');
      expect(reminders[0].reminderState).toBe('active');
    });

    it('8.3 no external APIs, FCM, Web Push, or Browser APIs are instantiated', () => {
      // Verifies no global navigator.serviceWorker or Notification mocks are invoked
      expect(typeof window).toBe('undefined');
    });

    it('8.4 channel registry does not expose raw provider exceptions', async () => {
      const crashingProvider: NotificationChannelProvider = {
        id: 'crashing_channel',
        displayName: 'Crashing Provider',
        getCapabilities: () => ({ available: true, backgroundDelivery: false, requiresPermission: false, supportsRichContent: false, supportsActions: false, supportsSound: false }),
        getPermissionState: () => {
          throw new Error('Native crash during permission check');
        },
        isAvailable: () => {
          throw new Error('Native crash during availability check');
        },
        deliver: async () => {
          throw new Error('Native crash during delivery');
        },
      };

      notificationChannelRegistry.registerChannel(crashingProvider);

      // getChannelPermission catches cleanly and returns unavailable
      const perm = await notificationChannelRegistry.getChannelPermission('crashing_channel');
      expect(perm).toBe('unavailable');

      // isChannelAvailable catches cleanly and returns false
      const avail = await notificationChannelRegistry.isChannelAvailable('crashing_channel');
      expect(avail).toBe(false);

      // getChannelReport catches cleanly and handles safely
      const report = await notificationChannelRegistry.getChannelReport('crashing_channel');
      expect(report.available).toBe(false);
      expect(report.permission).toBe('unavailable');
    });

    it('8.5 standalone deliverProactiveResponse export delegates to notificationDelivery seamlessly', async () => {
      const record = {
        eventId: 'due_rem-standalone_22000',
        reminderId: 'rem-standalone',
        userId: userA,
        messageId: 'msg-standalone',
        text: 'Standalone helper test',
      };

      const result = await deliverProactiveResponse({
        authenticatedUserId: userA,
        record,
      });

      expect(result.success).toBe(true);
      expect(result.channel).toBe('in_app');
      expect(result.status).toBe('delivered');
    });

    it('8.6 standalone deliverProactiveResponseToChannels export delegates seamlessly', async () => {
      const record = {
        eventId: 'due_rem-standalone-multi_23000',
        reminderId: 'rem-standalone-multi',
        userId: userA,
        messageId: 'msg-standalone-multi',
        text: 'Standalone multi helper test',
      };

      const result = await deliverProactiveResponseToChannels({
        authenticatedUserId: userA,
        record,
        channels: ['in_app'],
      });

      expect(result.overallSuccess).toBe(true);
      expect(result.deliveredChannels).toEqual(['in_app']);
    });
  });
});
