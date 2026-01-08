import { useState, useEffect } from 'react';

/**
 * Custom hook to detect responsive breakpoints
 * Tailwind breakpoints:
 * - sm: 640px
 * - md: 768px
 * - lg: 1024px
 * - xl: 1280px
 */
export const useResponsive = () => {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 640;
    }
    return false;
  });

  const [isTablet, setIsTablet] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 640 && window.innerWidth < 1024;
    }
    return false;
  });

  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024;
    }
    return true;
  });

  const [windowWidth, setWindowWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth;
    }
    return 1024;
  });

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      setWindowWidth(width);
      setIsMobile(width < 640);
      setIsTablet(width >= 640 && width < 1024);
      setIsDesktop(width >= 1024);
    };

    // Add event listener with debouncing to prevent excessive updates
    let timeoutId: ReturnType<typeof setTimeout>;
    const debouncedResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleResize, 150);
    };

    window.addEventListener('resize', debouncedResize);
    return () => {
      window.removeEventListener('resize', debouncedResize);
      clearTimeout(timeoutId);
    };
  }, []);

  return {
    isMobile,      // < 640px
    isTablet,      // 640px - 1023px
    isDesktop,     // >= 1024px
    windowWidth,
    // Useful shortcuts
    isSmallMobile: windowWidth < 360,
    isMediumDevice: windowWidth < 768,
    isLargeDevice: windowWidth >= 768,
  };
};
