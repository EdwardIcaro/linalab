/**
 * Mobile Navigation Handler
 * Manages hamburger menu and drawer navigation for mobile devices
 */

class MobileNav {
    constructor() {
        this.menuBtn = document.querySelector('.mobile-menu-btn');
        this.drawer = document.querySelector('.mobile-nav-drawer');
        this.overlay = document.querySelector('.mobile-nav-overlay');
        this.navItems = document.querySelectorAll('.mobile-nav-item');

        if (this.menuBtn && this.drawer && this.overlay) {
            this.init();
        }
    }

    init() {
        // Toggle drawer on menu button click
        this.menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Close drawer when clicking overlay
        this.overlay.addEventListener('click', () => {
            this.close();
        });

        // Close drawer when clicking a nav item
        this.navItems.forEach(item => {
            item.addEventListener('click', () => {
                this.close();
            });
        });

        // Close drawer when pressing Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        });

        // Prevent body scroll when drawer is open
        this.manageBodyScroll();
    }

    toggle() {
        if (this.drawer.classList.contains('open')) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.drawer.classList.add('open');
        this.overlay.classList.add('active');
        this.menuBtn.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    close() {
        this.drawer.classList.remove('open');
        this.overlay.classList.remove('active');
        this.menuBtn.classList.remove('active');
        document.body.style.overflow = '';
    }

    manageBodyScroll() {
        // Already handled in open() and close()
    }
}

// Initialize mobile navigation when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new MobileNav();
    });
} else {
    new MobileNav();
}

/**
 * Helper function to set active nav item based on current page
 */
function setActiveMobileNav(selector) {
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
        item.classList.remove('active');
    });

    const activeItem = document.querySelector(selector);
    if (activeItem) {
        activeItem.classList.add('active');
    }
}

/**
 * Close mobile drawer on window resize (desktop)
 */
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (window.innerWidth > 768) {
            const mobileNav = document.querySelector('.mobile-nav-drawer');
            if (mobileNav && mobileNav.classList.contains('open')) {
                // Close drawer on desktop
                const menuBtn = document.querySelector('.mobile-menu-btn');
                mobileNav.classList.remove('open');
                document.querySelector('.mobile-nav-overlay')?.classList.remove('active');
                menuBtn?.classList.remove('active');
                document.body.style.overflow = '';
            }
        }
    }, 250);
});

/**
 * Smooth scroll behavior for anchor links in drawer
 */
document.querySelectorAll('.mobile-nav-item[href^="#"]').forEach(link => {
    link.addEventListener('click', function(e) {
        const href = this.getAttribute('href');
        const target = document.querySelector(href);

        if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});

/**
 * Toggle menu mobile via bottom navigation
 */
function toggleMobileMenu(e) {
    e.preventDefault();

    // Try to toggle mobile drawer button first
    const menuBtn = document.querySelector('.mobile-menu-btn');
    if (menuBtn) {
        menuBtn.click();
        return;
    }

    // Fallback: Toggle nav-menu-card visibility with class
    const navMenu = document.querySelector('.nav-menu-card');
    if (navMenu) {
        navMenu.classList.toggle('open');

        // Create/toggle overlay for mobile menu
        let overlay = document.querySelector('.nav-menu-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'nav-menu-overlay';
            document.body.insertBefore(overlay, navMenu);
        }
        overlay.classList.toggle('active');

        // Close menu when clicking overlay
        overlay.onclick = (evt) => {
            evt.stopPropagation();
            navMenu.classList.remove('open');
            overlay.classList.remove('active');
        };

        // Close menu when clicking a nav item
        const navItems = navMenu.querySelectorAll('.nav-menu-item');
        navItems.forEach(item => {
            item.onclick = () => {
                navMenu.classList.remove('open');
                overlay.classList.remove('active');
            };
        });
    }
}
