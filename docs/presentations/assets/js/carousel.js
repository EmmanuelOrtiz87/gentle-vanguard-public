/* Carousel functionality for presentations */
(function () {
  'use strict';

  window.moveCarousel = function (carouselId, direction) {
    const carousel = document.getElementById(carouselId);
    if (!carousel) return;

    const slides = carousel.querySelectorAll('.gv-carousel-slide');
    const dots = carousel.querySelectorAll('.carousel-dots .dot');
    let currentIndex = 0;

    slides.forEach((slide, index) => {
      if (slide.classList.contains('active')) {
        currentIndex = index;
      }
    });

    const newIndex = (currentIndex + direction + slides.length) % slides.length;
    goToSlide(carouselId, newIndex);
  };

  window.goToSlide = function (carouselId, index) {
    const carousel = document.getElementById(carouselId);
    if (!carousel) return;

    const slides = carousel.querySelectorAll('.gv-carousel-slide');
    const dots = carousel.querySelectorAll('.carousel-dots .dot');

    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === index);
    });

    if (dots.length > 0) {
      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
      });
    }
  };

  // Auto-play functionality
  document.querySelectorAll('.gv-carousel[data-autoplay]').forEach((carousel) => {
    const interval = parseInt(carousel.getAttribute('data-autoplay')) || 5000;
    const carouselId = carousel.id;

    if (carouselId) {
      setInterval(() => {
        moveCarousel(carouselId, 1);
      }, interval);
    }
  });

  console.log('✅ Carousel system initialized');
})();
