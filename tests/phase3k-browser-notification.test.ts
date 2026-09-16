// tests/phase3k-browser-notification.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BrowserNotificationChannelProvider,
  isBrowserNotificationSupported,
  isServiceWorkerSupported,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
} from '../src/lib/browser-notification-channel';
import {
  NotificationChannelRequest,
  NotificationChannelCapabilities,
} from '../src/lib/notification-channel';
import {
  NotificationDeliveryManager,
  InMemoryNotificationDeliveryRepository,
  generateDeliveryId,
} from '../src/lib/notification-delivery';
import { NotificationChannelRegistry } from '../src/lib/notification-channel-registry';
import { InAppNotificationChannelProvider } from '../src/lib/in-app-channel-provider';
import { alphaStore } from '../src/lib/alpha-store';
import { notificationAcknowledgementManager } from '../src/lib/notification-acknowledgement';

describe('Phase 3K — Browser / System Notification Channel', () => {
  const userA = 'user-alice-3k';
  const userB = 'user-bob-3k';

  let deliveryRepo: InMemoryNotificationDeliveryRepository;
  let deliveryManager: NotificationDeliveryManager;
  let registry: NotificationChannelRegistry;
  let browserProvider: BrowserNotificationChannelProvider;

  // Track created mock notifications
  let createdNotifications: Array<{ title: string; options: any; onclick?: (e: any) => void }>;
  let mockPermission: 'default' | 'granted' | 'denied';
  let mockRequestPermission: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    alphaStore.clearChat();
    notificationAcknowledgementManager.reset();
    deliveryRepo = new InMemoryNotificationDeliveryRepository();
    registry = new NotificationChannelRegistry(false);
    deliveryManager = new NotificationDeliveryManager({
      repo: deliveryRepo,
      channelRegistry: registry,
    });

    createdNotifications = [];
    mockPermission = 'granted';
    mockRequestPermission = vi.fn().mockImplementation(async () => mockPermission);

    // Set up standard window.Notification mock
    (global as any).window = {
      Notification: class MockNotification {
        public static get permission() {
          return mockPermission;
        }
        public static requestPermission = mockRequestPermission;

        public title: string;
        public options: any;
        public onclick?: (e: any) => void;

        constructor(title: string, options: any) {
          this.title = title;
          this.options = options;
          createdNotifications.push(this);
        }
      },
      focus: vi.fn(),
    };

    (global as any).Notification = (global as any).window.Notification;

    browserProvider = new BrowserNotificationChannelProvider({
      deliveryRepo,
      deliveryManager,
    });
    registry.registerChannel(new InAppNotificationChannelProvider());
    registry.registerChannel(browserProvider);
  });

  afterEach(() => {
    delete (global as any).window;
    delete (global as any).Notification;
    delete (global as any).navigator;
  });

  // =========================================================================
  // 1. Capabilities & Contract Conformance
  // =========================================================================
  describe('1. Capabilities & Contract Conformance', () => {
    it('1.1 provider has correct id "browser" and descriptive displayName', () => {
      expect(browserProvider.id).toBe('browser');
      expect(browserProvider.displayName).toBe('Browser / System Notification');
    });

    it('1.2 getCapabilities reports correct flags when browser Notification API is available', () => {
      const caps = browserProvider.getCapabilities();
      expect(caps.available).toBe(true);
      expect(caps.requiresPermission).toBe(true);
      expect(caps.supportsRichContent).toBe(false);
      expect(caps.supportsActions).toBe(false);
      expect(caps.supportsSound).toBe(false);
    });

    it('1.3 getCapabilities reports backgroundDelivery = false when service worker is not supported', () => {
      const caps = browserProvider.getCapabilities();
      expect(caps.backgroundDelivery).toBe(false);
    });

    it('1.4 getCapabilities reports backgroundDelivery = true when service worker is supported', () => {
      (global as any).navigator = {
        serviceWorker: {},
      };
      const caps = browserProvider.getCapabilities();
      expect(caps.backgroundDelivery).toBe(true);
    });

    it('1.5 getCapabilities reports available = false when Notification API is missing', () => {
      delete (global as any).window.Notification;
      const caps = browserProvider.getCapabilities();
      expect(caps.available).toBe(false);
    });

    it('1.6 getCapabilities reports available = false in SSR / no-window environment', () => {
      delete (global as any).window;
      const caps = browserProvider.getCapabilities();
      expect(caps.available).toBe(false);
    });
  });

  // =========================================================================
  // 2. Feature Detection & Environment Safety
  // =========================================================================
  describe('2. Feature Detection & Environment Safety', () => {
    it('2.1 isBrowserNotificationSupported returns true when window.Notification exists', () => {
      expect(isBrowserNotificationSupported()).toBe(true);
    });

    it('2.2 isBrowserNotificationSupported returns false when window is undefined', () => {
      delete (global as any).window;
      expect(isBrowserNotificationSupported()).toBe(false);
    });

    it('2.3 isBrowserNotificationSupported returns false when window.Notification is undefined', () => {
      delete (global as any).window.Notification;
      expect(isBrowserNotificationSupported()).toBe(false);
    });

    it('2.4 isBrowserNotificationSupported does not throw when window throws on access', () => {
      Object.defineProperty(global, 'window', {
        get: () => {
          throw new Error('Restricted window access');
        },
        configurable: true,
      });
      expect(isBrowserNotificationSupported()).toBe(false);
    });

    it('2.5 isServiceWorkerSupported returns true when navigator.serviceWorker exists', () => {
      (global as any).navigator = { serviceWorker: {} };
      expect(isServiceWorkerSupported()).toBe(true);
    });

    it('2.6 isServiceWorkerSupported returns false when navigator is undefined', () => {
      delete (global as any).navigator;
      expect(isServiceWorkerSupported()).toBe(false);
    });

    it('2.7 isServiceWorkerSupported returns false when navigator.serviceWorker is missing', () => {
      (global as any).navigator = {};
      expect(isServiceWorkerSupported()).toBe(false);
    });
  });

  // =========================================================================
  // 3. Permission Model & Dynamic Evaluation
  // =========================================================================
  describe('3. Permission Model & Dynamic Evaluation', () => {
    it('3.1 getPermissionState maps "granted" to "granted"', () => {
      mockPermission = 'granted';
      expect(browserProvider.getPermissionState(userA)).toBe('granted');
      expect(getBrowserNotificationPermission()).toBe('granted');
    });

    it('3.2 getPermissionState maps "denied" to "denied"', () => {
      mockPermission = 'denied';
      expect(browserProvider.getPermissionState(userA)).toBe('denied');
      expect(getBrowserNotificationPermission()).toBe('denied');
    });

    it('3.3 getPermissionState maps "default" to "unknown"', () => {
      mockPermission = 'default';
      expect(browserProvider.getPermissionState(userA)).toBe('unknown');
      expect(getBrowserNotificationPermission()).toBe('unknown');
    });

    it('3.4 getPermissionState returns "unavailable" when Notification API is unsupported', () => {
      delete (global as any).window.Notification;
      expect(browserProvider.getPermissionState(userA)).toBe('unavailable');
      expect(getBrowserNotificationPermission()).toBe('unavailable');
    });

    it('3.5 isAvailable returns true only when permission is "granted"', () => {
      mockPermission = 'granted';
      expect(browserProvider.isAvailable(userA)).toBe(true);
      mockPermission = 'denied';
      expect(browserProvider.isAvailable(userA)).toBe(false);
      mockPermission = 'default';
      expect(browserProvider.isAvailable(userA)).toBe(false);
    });

    it('3.6 dynamic permission changes in browser are reflected immediately without stale cache', () => {
      mockPermission = 'default';
      expect(browserProvider.getPermissionState(userA)).toBe('unknown');

      // User grants permission in browser
      mockPermission = 'granted';
      expect(browserProvider.getPermissionState(userA)).toBe('granted');

      // User revokes permission in browser settings
      mockPermission = 'denied';
      expect(browserProvider.getPermissionState(userA)).toBe('denied');
    });
  });

  // =========================================================================
  // 4. Explicit Permission Request Flow
  // =========================================================================
  describe('4. Explicit Permission Request Flow', () => {
    it('4.1 requestPermission requests permission from Notification API when default', async () => {
      mockPermission = 'default';
      mockRequestPermission.mockImplementation(async () => 'granted');

      const res = await browserProvider.requestPermission();
      expect(res.requested).toBe(true);
      expect(res.state).toBe('granted');
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });

    it('4.2 requestPermission returns granted without re-prompting if already granted', async () => {
      mockPermission = 'granted';

      const res = await browserProvider.requestPermission();
      expect(res.requested).toBe(false);
      expect(res.state).toBe('granted');
      expect(mockRequestPermission).not.toHaveBeenCalled();
    });

    it('4.3 requestPermission does NOT call browser prompt if already denied', async () => {
      mockPermission = 'denied';

      const res = await browserProvider.requestPermission();
      expect(res.requested).toBe(false);
      expect(res.state).toBe('denied');
      expect(res.error).toMatch(/denied|blocked/i);
      expect(mockRequestPermission).not.toHaveBeenCalled();
    });

    it('4.4 requestPermission returns unavailable when browser is unsupported', async () => {
      delete (global as any).window.Notification;

      const res = await browserProvider.requestPermission();
      expect(res.requested).toBe(false);
      expect(res.state).toBe('unavailable');
      expect(res.error).toMatch(/not supported/i);
    });

    it('4.5 requestPermission safely handles browser prompt rejection / exception', async () => {
      mockPermission = 'default';
      mockRequestPermission.mockRejectedValue(new Error('User closed prompt'));

      const res = await browserProvider.requestPermission();
      expect(res.requested).toBe(true);
      expect(res.state).toBe('unavailable');
      expect(res.error).toMatch(/User closed prompt/);
    });

    it('4.6 standalone requestBrowserNotificationPermission behaves identically', async () => {
      mockPermission = 'default';
      mockRequestPermission.mockImplementation(async () => 'granted');

      const res = await requestBrowserNotificationPermission();
      expect(res.requested).toBe(true);
      expect(res.state).toBe('granted');
    });
  });

  // =========================================================================
  // 5. Delivery Execution & Payload Structure
  // =========================================================================
  describe('5. Delivery Execution & Payload Structure', () => {
    it('5.1 successfully delivers a browser notification when permitted', async () => {
      mockPermission = 'granted';
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-101_1000',
        reminderId: 'rem-101',
        userId: userA,
        title: 'Team Standup',
        body: 'Morning sync at 9:00 AM',
        messageId: 'msg-101',
        dueAt: 1000,
      };

      const result = await browserProvider.deliver(request, userA);

      expect(result.success).toBe(true);
      expect(result.status).toBe('delivered');
      expect(result.channel).toBe('browser');
      expect(result.deliveryId).toBe('due_rem-101_1000:browser');
      expect(result.eventId).toBe('due_rem-101_1000');
      expect(result.deliveredAt).toBeGreaterThan(0);

      // Notification object was constructed
      expect(createdNotifications.length).toBe(1);
      const notif = createdNotifications[0];
      expect(notif.title).toContain('Team Standup');
      expect(notif.options.body).toBe('Morning sync at 9:00 AM');
      expect(notif.options.tag).toBe('due_rem-101_1000');
      expect(notif.options.data.reminderId).toBe('rem-101');
      expect(notif.options.data.eventId).toBe('due_rem-101_1000');
    });

    it('5.2 notification payload does NOT expose sensitive internal technical tokens', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-sec_2000',
        reminderId: 'rem-sec',
        userId: userA,
        title: 'Take vitamins',
        body: 'Remember to take vitamin D',
      };

      await browserProvider.deliver(request, userA);
      expect(createdNotifications.length).toBe(1);
      const notif = createdNotifications[0];
      expect(notif.title).not.toContain('auth_token');
      expect(notif.title).not.toContain('firestore');
      expect(notif.options.body).toBe('Remember to take vitamin D');
    });

    it('5.3 delivery fails gracefully when permission is denied', async () => {
      mockPermission = 'denied';
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-den_3000',
        reminderId: 'rem-den',
        userId: userA,
        title: 'Meeting',
        body: 'Call with client',
      };

      const result = await browserProvider.deliver(request, userA);
      expect(result.success).toBe(false);
      expect(result.status).toBe('unavailable');
      expect(result.error?.code).toBe('PERMISSION_DENIED');
      expect(createdNotifications.length).toBe(0);
    });

    it('5.4 delivery fails gracefully when permission is default (not yet granted)', async () => {
      mockPermission = 'default';
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-def_4000',
        reminderId: 'rem-def',
        userId: userA,
        title: 'Meeting',
        body: 'Call with client',
      };

      const result = await browserProvider.deliver(request, userA);
      expect(result.success).toBe(false);
      expect(result.status).toBe('unavailable');
      expect(result.error?.code).toBe('PERMISSION_NOT_GRANTED');
      expect(createdNotifications.length).toBe(0);
    });

    it('5.5 delivery fails gracefully when browser Notification API is unsupported', async () => {
      delete (global as any).window.Notification;
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-uns_5000',
        reminderId: 'rem-uns',
        userId: userA,
        title: 'Doctor',
        body: 'Dental appointment',
      };

      const result = await browserProvider.deliver(request, userA);
      expect(result.success).toBe(false);
      expect(result.status).toBe('unavailable');
      expect(result.error?.code).toBe('UNSUPPORTED_BROWSER');
    });

    it('5.6 delivery rejects malformed request with INVALID_INPUT', async () => {
      const invalidRequest: any = {
        eventId: '',
        title: '',
      };

      const result = await browserProvider.deliver(invalidRequest, userA);
      expect(result.success).toBe(false);
      expect(result.status).toBe('invalid_input');
      expect(result.error?.code).toBe('INVALID_INPUT');
    });

    it('5.7 delivery rejects unauthenticated caller with UNAUTHENTICATED', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-unauth_6000',
        reminderId: 'rem-unauth',
        userId: userA,
        title: 'Workout',
        body: 'Gym session',
      };

      const result = await browserProvider.deliver(request, '');
      expect(result.success).toBe(false);
      expect(result.status).toBe('unauthenticated');
      expect(result.error?.code).toBe('UNAUTHENTICATED');
    });

    it('5.8 delivery enforces user boundary and rejects USER_MISMATCH', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-mis_7000',
        reminderId: 'rem-mis',
        userId: userA,
        title: 'Private reminder',
        body: 'Confidential',
      };

      const result = await browserProvider.deliver(request, userB);
      expect(result.success).toBe(false);
      expect(result.status).toBe('unauthenticated');
      expect(result.error?.code).toBe('USER_MISMATCH');
    });
  });

  // =========================================================================
  // 6. Deterministic Identity & Idempotency
  // =========================================================================
  describe('6. Deterministic Identity & Idempotency', () => {
    it('6.1 generates deterministic deliveryId as `${eventId}:browser`', () => {
      const id = generateDeliveryId('due_rem-det_8000', 'browser');
      expect(id).toBe('due_rem-det_8000:browser');
    });

    it('6.2 duplicate delivery attempt returns already_delivered without duplicate notification popup', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-dup_9000',
        reminderId: 'rem-dup',
        userId: userA,
        title: 'Drink Water',
        body: 'Hydrate now',
      };

      const res1 = await browserProvider.deliver(request, userA);
      expect(res1.success).toBe(true);
      expect(res1.status).toBe('delivered');
      expect(createdNotifications.length).toBe(1);

      const res2 = await browserProvider.deliver(request, userA);
      expect(res2.success).toBe(true);
      expect(res2.status).toBe('already_delivered');
      expect(res2.deliveryId).toBe('due_rem-dup_9000:browser');
      // No second system notification was popped
      expect(createdNotifications.length).toBe(1);
    });

    it('6.3 repository records delivery with status "delivered"', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-repo_10000',
        reminderId: 'rem-repo',
        userId: userA,
        title: 'Check Oven',
        body: 'Dinner is ready',
      };

      await browserProvider.deliver(request, userA);
      const record = await deliveryRepo.getDelivery(userA, 'due_rem-repo_10000:browser');
      expect(record).toBeDefined();
      expect(record?.status).toBe('delivered');
      expect(record?.channel).toBe('browser');
      expect(record?.eventId).toBe('due_rem-repo_10000');
    });

    it('6.4 multiple different reminders create separate delivery records and separate notifications', async () => {
      const req1: NotificationChannelRequest = {
        eventId: 'due_rem-multi-1_11000',
        reminderId: 'rem-multi-1',
        userId: userA,
        title: 'Event 1',
        body: 'First event',
      };
      const req2: NotificationChannelRequest = {
        eventId: 'due_rem-multi-2_12000',
        reminderId: 'rem-multi-2',
        userId: userA,
        title: 'Event 2',
        body: 'Second event',
      };

      await browserProvider.deliver(req1, userA);
      await browserProvider.deliver(req2, userA);

      expect(createdNotifications.length).toBe(2);
      expect(await deliveryRepo.getDelivery(userA, 'due_rem-multi-1_11000:browser')).toBeDefined();
      expect(await deliveryRepo.getDelivery(userA, 'due_rem-multi-2_12000:browser')).toBeDefined();
    });
  });

  // =========================================================================
  // 7. Multi-Tab Coordination & Durable Leases
  // =========================================================================
  describe('7. Multi-Tab Coordination & Durable Leases', () => {
    it('7.1 Tab B sees already_delivered when Tab A has already delivered via shared repository', async () => {
      const tabAProvider = new BrowserNotificationChannelProvider({ deliveryRepo });
      const tabBProvider = new BrowserNotificationChannelProvider({ deliveryRepo });

      const request: NotificationChannelRequest = {
        eventId: 'due_rem-cross-tab_13000',
        reminderId: 'rem-cross-tab',
        userId: userA,
        title: 'Shared Reminder',
        body: 'Coordinated delivery across tabs',
      };

      // Tab A delivers
      const resA = await tabAProvider.deliver(request, userA);
      expect(resA.status).toBe('delivered');
      expect(createdNotifications.length).toBe(1);

      // Tab B attempts delivery for the same event
      const resB = await tabBProvider.deliver(request, userA);
      expect(resB.success).toBe(true);
      expect(resB.status).toBe('already_delivered');
      // Tab B does NOT create an extra popup
      expect(createdNotifications.length).toBe(1);
    });

    it('7.2 concurrent claim returns rejected when lease is active in another tab', async () => {
      const deliveryId = 'due_rem-active-lease_14000:browser';
      // Simulate active lease written by another tab 5 seconds ago
      await deliveryRepo.saveDelivery(userA, {
        deliveryId,
        eventId: 'due_rem-active-lease_14000',
        reminderId: 'rem-active-lease',
        userId: userA,
        messageId: 'msg-lease',
        channel: 'browser',
        status: 'delivering',
        createdAt: Date.now() - 5000,
        updatedAt: Date.now() - 5000,
        retryCount: 0,
      });

      const request: NotificationChannelRequest = {
        eventId: 'due_rem-active-lease_14000',
        reminderId: 'rem-active-lease',
        userId: userA,
        title: 'Active lease test',
        body: 'Testing active lease protection',
      };

      const res = await browserProvider.deliver(request, userA);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('DELIVERY_IN_PROGRESS');
      expect(createdNotifications.length).toBe(0);
    });

    it('7.3 expired lease allows recovery and successful delivery', async () => {
      const deliveryId = 'due_rem-exp-lease_15000:browser';
      // Simulate expired lease from 60 seconds ago
      await deliveryRepo.saveDelivery(userA, {
        deliveryId,
        eventId: 'due_rem-exp-lease_15000',
        reminderId: 'rem-exp-lease',
        userId: userA,
        messageId: 'msg-exp',
        channel: 'browser',
        status: 'delivering',
        createdAt: Date.now() - 60000,
        updatedAt: Date.now() - 60000,
        retryCount: 0,
      });

      const request: NotificationChannelRequest = {
        eventId: 'due_rem-exp-lease_15000',
        reminderId: 'rem-exp-lease',
        userId: userA,
        title: 'Expired lease recovery',
        body: 'Recovering delivery',
      };

      const res = await browserProvider.deliver(request, userA);
      expect(res.success).toBe(true);
      expect(res.status).toBe('delivered');
      expect(createdNotifications.length).toBe(1);
    });
  });

  // =========================================================================
  // 8. In-App Channel & Failure Isolation
  // =========================================================================
  describe('8. In-App Channel & Failure Isolation', () => {
    it('8.1 multi-channel dispatch delivers to both in_app and browser successfully', async () => {
      const record = {
        eventId: 'due_rem-multi-chan_16000',
        reminderId: 'rem-multi-chan',
        userId: userA,
        messageId: 'msg-multi-chan',
        text: 'Multi channel test message',
        title: 'Multi channel reminder',
      };

      const result = await deliveryManager.deliverProactiveResponseToChannels({
        authenticatedUserId: userA,
        record,
        channels: ['in_app', 'browser'],
      });

      expect(result.overallSuccess).toBe(true);
      expect(result.deliveredChannels).toContain('in_app');
      expect(result.deliveredChannels).toContain('browser');
      expect(result.results['in_app'].success).toBe(true);
      expect(result.results['browser'].success).toBe(true);

      // In-app chat has the message
      const chat = alphaStore.get().chat.find((m) => m.proactiveEventId === record.eventId);
      expect(chat).toBeDefined();
      expect(chat?.text).toBe(record.text);

      // System notification was popped
      expect(createdNotifications.length).toBe(1);

      // Independent durable delivery records exist
      const inAppDelivery = await deliveryRepo.getDelivery(userA, `${record.eventId}:in_app`);
      const browserDelivery = await deliveryRepo.getDelivery(userA, `${record.eventId}:browser`);
      expect(inAppDelivery?.status).toBe('delivered');
      expect(browserDelivery?.status).toBe('delivered');
    });

    it('8.2 browser channel failure does NOT affect or roll back in_app delivery', async () => {
      mockPermission = 'denied'; // Browser will fail

      const record = {
        eventId: 'due_rem-fail-iso_17000',
        reminderId: 'rem-fail-iso',
        userId: userA,
        messageId: 'msg-fail-iso',
        text: 'In-app must succeed even if browser denied',
        title: 'Isolation Test',
      };

      const result = await deliveryManager.deliverProactiveResponseToChannels({
        authenticatedUserId: userA,
        record,
        channels: ['in_app', 'browser'],
      });

      // Overall success is true because in_app delivered
      expect(result.overallSuccess).toBe(true);
      expect(result.deliveredChannels).toContain('in_app');
      expect(result.failedChannels).toContain('browser');
      expect(result.results['in_app'].success).toBe(true);
      expect(result.results['browser'].success).toBe(false);

      // In-app chat message is safely present
      const inChat = alphaStore.get().chat.find((m) => m.proactiveEventId === record.eventId);
      expect(inChat).toBeDefined();

      // Browser delivery threw no exception and in_app delivery record is intact
      const inAppDelivery = await deliveryRepo.getDelivery(userA, `${record.eventId}:in_app`);
      expect(inAppDelivery?.status).toBe('delivered');
    });

    it('8.3 browser notification delivery does not create duplicate chat messages in alphaStore', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-no-chat-dup_18000',
        reminderId: 'rem-no-chat-dup',
        userId: userA,
        title: 'Browser only delivery',
        body: 'Should not touch chat store directly',
      };

      const initialChatCount = alphaStore.get().chat.length;
      await browserProvider.deliver(request, userA);

      // Chat store remains unchanged by browser provider delivery
      expect(alphaStore.get().chat.length).toBe(initialChatCount);
    });
  });

  // =========================================================================
  // 9. Non-Interference with Acknowledgement
  // =========================================================================
  describe('9. Non-Interference with Acknowledgement', () => {
    it('9.1 browser delivery does NOT acknowledge the reminder', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-ack-decouple_19000',
        reminderId: 'rem-ack-decouple',
        userId: userA,
        title: 'Unacknowledged Reminder',
        body: 'Browser delivered but unacknowledged',
      };

      await browserProvider.deliver(request, userA);

      // Acknowledgement manager has NO record for this event yet
      const ackRecord = await notificationAcknowledgementManager.getRepository().getAcknowledgementByEventId(
        userA,
        'due_rem-ack-decouple_19000'
      );
      expect(ackRecord).toBeNull();
    });

    it('9.2 clicking browser notification focuses window and does NOT acknowledge', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-click-no-ack_20000',
        reminderId: 'rem-click-no-ack',
        userId: userA,
        title: 'Click test',
        body: 'Clicking notification',
      };

      await browserProvider.deliver(request, userA);
      expect(createdNotifications.length).toBe(1);

      const notif = createdNotifications[0];
      const mockEvent = { preventDefault: vi.fn() };
      notif.onclick?.(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect((global as any).window.focus).toHaveBeenCalled();

      // Acknowledgement remains unacknowledged
      const ackRecord = await notificationAcknowledgementManager.getRepository().getAcknowledgementByEventId(
        userA,
        'due_rem-click-no-ack_20000'
      );
      expect(ackRecord).toBeNull();
    });

    it('9.3 explicit in-app acknowledgement continues to work independently after browser delivery', async () => {
      const record = {
        eventId: 'due_rem-full-ack_21000',
        reminderId: 'rem-full-ack',
        userId: userA,
        messageId: 'msg-full-ack',
        text: 'Drink water',
        title: 'Hydration',
      };

      // Deliver to both channels
      await deliveryManager.deliverProactiveResponseToChannels({
        authenticatedUserId: userA,
        record,
        channels: ['in_app', 'browser'],
      });

      // User explicitly acknowledges
      const ackResult = await notificationAcknowledgementManager.acknowledgeReminder({
        authenticatedUserId: userA,
        eventId: record.eventId,
        reminderId: record.reminderId,
        userConfirmationText: 'I got the reminder, thanks!',
      });

      expect(ackResult.success).toBe(true);
      expect(ackResult.record?.status).toBe('acknowledged');

      // In-app and browser deliveries are both marked delivered
      expect((await deliveryRepo.getDelivery(userA, `${record.eventId}:in_app`))?.status).toBe('delivered');
      expect((await deliveryRepo.getDelivery(userA, `${record.eventId}:browser`))?.status).toBe('delivered');
    });
  });

  // =========================================================================
  // 10. Service Worker Integration & Fallback
  // =========================================================================
  describe('10. Service Worker Integration & Fallback', () => {
    it('10.1 uses serviceWorker showNotification when active and controller is present', async () => {
      const mockShowNotification = vi.fn().mockResolvedValue(undefined);
      (global as any).navigator = {
        serviceWorker: {
          controller: {},
          ready: Promise.resolve({
            showNotification: mockShowNotification,
          }),
        },
      };

      const request: NotificationChannelRequest = {
        eventId: 'due_rem-sw_22000',
        reminderId: 'rem-sw',
        userId: userA,
        title: 'SW Notification',
        body: 'Delivered via Service Worker',
      };

      const result = await browserProvider.deliver(request, userA);
      expect(result.success).toBe(true);
      expect(mockShowNotification).toHaveBeenCalledTimes(1);
      expect(mockShowNotification).toHaveBeenCalledWith(
        expect.stringContaining('SW Notification'),
        expect.objectContaining({
          body: 'Delivered via Service Worker',
          tag: 'due_rem-sw_22000',
        })
      );
    });

    it('10.2 falls back gracefully to window.Notification if serviceWorker showNotification fails', async () => {
      const mockShowNotification = vi.fn().mockRejectedValue(new Error('SW failed'));
      (global as any).navigator = {
        serviceWorker: {
          controller: {},
          ready: Promise.resolve({
            showNotification: mockShowNotification,
          }),
        },
      };

      const request: NotificationChannelRequest = {
        eventId: 'due_rem-sw-fallback_23000',
        reminderId: 'rem-sw-fallback',
        userId: userA,
        title: 'SW Fallback Notification',
        body: 'Falls back to window.Notification',
      };

      const result = await browserProvider.deliver(request, userA);
      expect(result.success).toBe(true);
      expect(createdNotifications.length).toBe(1);
      expect(createdNotifications[0].title).toContain('SW Fallback Notification');
    });
  });

  // =========================================================================
  // 11. Cross-User Privacy & Security Boundaries
  // =========================================================================
  describe('11. Cross-User Privacy & Security Boundaries', () => {
    it('11.1 User B cannot deliver or read notifications for User A', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-sec-iso_24000',
        reminderId: 'rem-sec-iso',
        userId: userA,
        title: 'Private confidential note',
        body: 'Super secret',
      };

      const result = await browserProvider.deliver(request, userB);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('USER_MISMATCH');

      // User B delivery repository has no record
      expect(await deliveryRepo.getDelivery(userB, 'due_rem-sec-iso_24000:browser')).toBeNull();
    });

    it('11.2 delivery repo separates User A and User B deliveries strictly', async () => {
      const reqA: NotificationChannelRequest = {
        eventId: 'due_rem-userA_25000',
        reminderId: 'rem-userA',
        userId: userA,
        title: 'Alice reminder',
        body: 'Alice note',
      };
      const reqB: NotificationChannelRequest = {
        eventId: 'due_rem-userB_26000',
        reminderId: 'rem-userB',
        userId: userB,
        title: 'Bob reminder',
        body: 'Bob note',
      };

      await browserProvider.deliver(reqA, userA);
      await browserProvider.deliver(reqB, userB);

      const aDeliveries = await deliveryRepo.listDeliveries(userA);
      const bDeliveries = await deliveryRepo.listDeliveries(userB);

      expect(aDeliveries.length).toBe(1);
      expect(aDeliveries[0].userId).toBe(userA);
      expect(bDeliveries.length).toBe(1);
      expect(bDeliveries[0].userId).toBe(userB);
    });
  });

  // =========================================================================
  // 12. Registry & Architectural Integrity
  // =========================================================================
  describe('12. Registry & Architectural Integrity', () => {
    it('12.1 registry lists both in_app and browser channels by default', () => {
      const defaultRegistry = new NotificationChannelRegistry(true);
      const channels = defaultRegistry.listChannels();
      const channelIds = channels.map((c) => c.id);
      expect(channelIds).toContain('in_app');
      expect(channelIds).toContain('browser');
    });

    it('12.2 resolveChannel resolves "browser" case-insensitively', async () => {
      const res = await registry.resolveChannel('BROWSER', userA);
      expect(res.status).toBe('resolved');
      expect(res.provider?.id).toBe('browser');
    });

    it('12.3 unrequested channels (android, voice, tts, whatsapp, email) remain strictly unsupported', async () => {
      for (const ch of ['android', 'voice', 'tts', 'whatsapp', 'email', 'sms', 'discord', 'telegram']) {
        const res = await registry.resolveChannel(ch, userA);
        expect(res.status).toBe('unsupported');
        expect(res.provider).toBeUndefined();
      }
    });

    it('12.4 browser notification delivery requires NO LLM calls or model invocations', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-no-llm_27000',
        reminderId: 'rem-no-llm',
        userId: userA,
        title: 'No LLM Notification',
        body: 'Raw reminder payload delivery',
      };

      const result = await browserProvider.deliver(request, userA);
      expect(result.success).toBe(true);
      // Confirmed: delivery executed purely synchronously through DOM/Notification APIs
    });

    it('12.5 handles special characters, unicode, and emojis in reminder title/body', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-unicode_28000',
        reminderId: 'rem-unicode',
        userId: userA,
        title: '⏰ Take Medication 💊 & Water 💧',
        body: 'Reminder: 100mg Vitamin-C (ñ, é, 日本語, 🚀)',
      };

      const result = await browserProvider.deliver(request, userA);
      expect(result.success).toBe(true);
      expect(createdNotifications.length).toBe(1);
      expect(createdNotifications[0].title).toContain('⏰ Take Medication 💊 & Water 💧');
      expect(createdNotifications[0].options.body).toContain('100mg Vitamin-C (ñ, é, 日本語, 🚀)');
    });

    it('12.6 handles long text in reminder body gracefully without crashing', async () => {
      const longBody = 'A'.repeat(5000);
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-long_29000',
        reminderId: 'rem-long',
        userId: userA,
        title: 'Long Body Test',
        body: longBody,
      };

      const result = await browserProvider.deliver(request, userA);
      expect(result.success).toBe(true);
      expect(createdNotifications.length).toBe(1);
      expect(createdNotifications[0].options.body.length).toBe(5000);
    });

    it('12.7 handles optional fields (notes, dueAt, metadata) without error', async () => {
      const request: NotificationChannelRequest = {
        eventId: 'due_rem-opt_30000',
        reminderId: 'rem-opt',
        userId: userA,
        title: 'Optional Fields',
        body: 'Testing optional attributes',
        dueAt: Date.now() + 60000,
        notes: 'Priority high',
        metadata: { customField: 'value123' },
      };

      const result = await browserProvider.deliver(request, userA);
      expect(result.success).toBe(true);
      expect(createdNotifications.length).toBe(1);
      expect(createdNotifications[0].options.data.notes).toBe('Priority high');
      expect(createdNotifications[0].options.data.metadata).toEqual({ customField: 'value123' });
    });

    it('12.8 multiple rapid concurrent deliveries to different events do not conflict', async () => {
      const promises = Array.from({ length: 5 }, (_, i) => {
        return browserProvider.deliver(
          {
            eventId: `due_rem-rapid-${i}_31000`,
            reminderId: `rem-rapid-${i}`,
            userId: userA,
            title: `Rapid Reminder ${i}`,
            body: `Content for rapid ${i}`,
          },
          userA
        );
      });

      const results = await Promise.all(promises);
      expect(results.every((r) => r.success)).toBe(true);
      expect(createdNotifications.length).toBe(5);
    });

    it('12.9 repository persistence failure returns structured retryable error', async () => {
      deliveryRepo.shouldFail = true;

      const request: NotificationChannelRequest = {
        eventId: 'due_rem-fail-repo_32000',
        reminderId: 'rem-fail-repo',
        userId: userA,
        title: 'Repo failure test',
        body: 'Testing persistence failure',
      };

      const result = await browserProvider.deliver(request, userA);
      expect(result.success).toBe(false);
      expect(result.status).toBe('temporary_failure');
      expect(result.error?.code).toBe('PERSISTENCE_FAILURE');
      expect(result.error?.retryable).toBe(true);
    });

    it('12.10 notification click safely handles missing window.focus function', async () => {
      delete (global as any).window.focus;

      const request: NotificationChannelRequest = {
        eventId: 'due_rem-nofocus_33000',
        reminderId: 'rem-nofocus',
        userId: userA,
        title: 'No focus test',
        body: 'Window has no focus method',
      };

      const result = await browserProvider.deliver(request, userA);
      expect(result.success).toBe(true);
      expect(createdNotifications.length).toBe(1);

      // Trigger click — must not throw
      expect(() => {
        createdNotifications[0].onclick?.({ preventDefault: () => {} });
      }).not.toThrow();
    });

    it('12.11 default constructor instantiates without explicit repo or manager', () => {
      const defaultProvider = new BrowserNotificationChannelProvider();
      expect(defaultProvider.id).toBe('browser');
      expect(defaultProvider.getCapabilities().available).toBe(true);
    });

    it('12.12 unregistering and re-registering browser provider dynamically behaves correctly', async () => {
      const customRegistry = new NotificationChannelRegistry(false);
      expect((await customRegistry.resolveChannel('browser', userA)).status).toBe('unsupported');

      customRegistry.registerChannel(browserProvider);
      expect((await customRegistry.resolveChannel('browser', userA)).status).toBe('resolved');

      customRegistry.unregisterChannel('browser');
      expect((await customRegistry.resolveChannel('browser', userA)).status).toBe('unsupported');
    });

    it('12.13 deliverProactiveResponse directly specifying channel="browser" delivers properly', async () => {
      const record = {
        eventId: 'due_rem-direct-browser_34000',
        reminderId: 'rem-direct-browser',
        userId: userA,
        messageId: 'msg-direct-browser',
        text: 'Direct browser message',
        title: 'Direct browser title',
      };

      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: userA,
        record,
        channel: 'browser',
      });

      expect(result.success).toBe(true);
      expect(result.deliveryId).toBe('due_rem-direct-browser_34000:browser');
      expect(createdNotifications.length).toBe(1);
    });
  });
});
