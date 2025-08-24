import { ref } from "vue";

export interface Notification {
  id: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
  timeout?: number;
}

export function useNotifications() {
  const notifications = ref<Notification[]>([]);

  const addNotification = (notification: Omit<Notification, "id">) => {
    const id = Date.now().toString();
    const newNotification: Notification = {
      ...notification,
      id,
      timeout: notification.timeout ?? 5000,
    };

    notifications.value.push(newNotification);

    // Auto-remove after timeout
    if (newNotification.timeout && newNotification.timeout > 0) {
      setTimeout(() => {
        removeNotification(id);
      }, newNotification.timeout);
    }

    return id;
  };

  const removeNotification = (id: string) => {
    const index = notifications.value.findIndex((n) => n.id === id);
    if (index > -1) {
      notifications.value.splice(index, 1);
    }
  };

  const success = (message: string, timeout?: number) => {
    return addNotification({ message, type: "success", timeout });
  };

  const error = (message: string, timeout?: number) => {
    return addNotification({ message, type: "error", timeout });
  };

  const warning = (message: string, timeout?: number) => {
    return addNotification({ message, type: "warning", timeout });
  };

  const info = (message: string, timeout?: number) => {
    return addNotification({ message, type: "info", timeout });
  };

  const clear = () => {
    notifications.value = [];
  };

  return {
    notifications,
    addNotification,
    removeNotification,
    success,
    error,
    warning,
    info,
    clear,
  };
}
