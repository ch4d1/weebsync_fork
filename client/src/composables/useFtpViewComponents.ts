import { ref, reactive } from "vue";
import { useCommunication } from "../communication";

interface PluginFtpViewComponent {
  id: string;
  name: string;
  description: string;
  supportedPathPatterns: string[];
  priority: number;
  component: {
    template: string;
    props?: string[];
    emits?: string[];
    data?: () => any;
    computed?: { [key: string]: () => any };
    methods?: { [key: string]: (...args: any[]) => any };
    mounted?: () => void;
    beforeUnmount?: () => void;
    style?: string;
  };
  sortOptions?: Array<{
    title: string;
    value: string;
  }>;
  enrichMetadata?: (items: any[], path: string) => Promise<any[]>;
}

const availableComponents = ref<PluginFtpViewComponent[]>([]);
const componentCache = reactive(new Map<string, PluginFtpViewComponent[]>());

export function useFtpViewComponents() {
  const communication = useCommunication();

  /**
   * Find matching components for a given path
   */
  function getComponentsForPath(path: string): PluginFtpViewComponent[] {
    // Check cache first
    if (componentCache.has(path)) {
      return componentCache.get(path) || [];
    }

    // Filter components by path patterns
    const matchingComponents = availableComponents.value.filter((component) => {
      return component.supportedPathPatterns.some((pattern) => {
        try {
          const regex = new RegExp(pattern);
          return regex.test(path);
        } catch (e) {
          console.warn("Invalid regex pattern:", pattern, e);
          return false;
        }
      });
    });

    // Sort by priority (higher priority first)
    matchingComponents.sort((a, b) => b.priority - a.priority);

    // Cache the result
    componentCache.set(path, matchingComponents);

    return matchingComponents;
  }

  /**
   * Get the best matching component for a path
   */
  function getBestComponentForPath(
    path: string,
  ): PluginFtpViewComponent | null {
    const components = getComponentsForPath(path);
    return components.length > 0 ? components[0] : null;
  }

  /**
   * Check if there are any components available for a path
   */
  function hasComponentsForPath(path: string): boolean {
    return getComponentsForPath(path).length > 0;
  }

  /**
   * Refresh available components from server
   */
  async function refreshComponents(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!communication.socket) {
        reject(new Error("Socket not available"));
        return;
      }

      try {
        (communication.socket as any).emit(
          "getFtpViewComponents",
          (components: PluginFtpViewComponent[]) => {
            console.log("Received FTP view components:", components);

            if (Array.isArray(components)) {
              availableComponents.value = components;

              // Clear cache since components might have changed
              componentCache.clear();

              console.log(`Loaded ${components.length} FTP view components`);
              resolve();
            } else {
              console.warn("Invalid components response:", components);
              availableComponents.value = [];
              resolve();
            }
          },
        );
      } catch (error) {
        console.error("Error refreshing FTP view components:", error);
        reject(
          new Error(error instanceof Error ? error.message : String(error)),
        );
      }
    });
  }

  /**
   * Initialize components on first load
   */
  async function initializeComponents(): Promise<void> {
    try {
      await refreshComponents();
    } catch (error) {
      console.error("Failed to initialize FTP view components:", error);
      // Don't throw - fallback to default viewer
    }
  }

  return {
    availableComponents: availableComponents,
    getComponentsForPath,
    getBestComponentForPath,
    hasComponentsForPath,
    refreshComponents,
    initializeComponents,
  };
}
