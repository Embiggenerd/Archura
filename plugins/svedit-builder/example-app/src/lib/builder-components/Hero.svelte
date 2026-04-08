<script lang="ts">
  let {
    eyebrow = 'New',
    title = 'Hello world',
    description = 'This is a hero block.',
    bgColor = '#f0f0f0'
  } = $props();
</script>

<section class="hero" style={`background:${bgColor};`}>
  <p>{eyebrow}</p>
  <h1>{title}</h1>
  <p class="description">{description}</p>
</section>

<style>
  .hero {
    border-radius: 18px;
    padding: 24px;
  }

  p {
    margin: 0 0 10px;
  }

  h1 {
    margin: 0 0 12px;
    font-size: clamp(2rem, 5vw, 3rem);
    line-height: 0.95;
  }

  .description {
    max-width: 42ch;
    line-height: 1.5;
  }
</style>
