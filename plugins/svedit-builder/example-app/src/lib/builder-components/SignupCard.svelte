<script lang="ts">
  let {
    title = 'Join the beta',
    buttonText = 'Create account',
    bgColor = '#fff6ee'
  } = $props();
</script>

<section class="card" style={`background:${bgColor};`}>
  <h2>{title}</h2>
  <label>
    <span>Email</span>
    <input type="email" placeholder="jane@company.com" />
  </label>
  <button type="button">{buttonText}</button>
</section>

<style>
  .card {
    display: grid;
    gap: 12px;
    border-radius: 18px;
    padding: 20px;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  label {
    display: grid;
    gap: 8px;
  }

  input {
    padding: 12px 14px;
    border: 1px solid rgba(31, 26, 23, 0.18);
    border-radius: 12px;
    font: inherit;
  }

  button {
    border: 0;
    border-radius: 14px;
    padding: 12px 16px;
    background: #cb5b2c;
    color: white;
    font: inherit;
  }
</style>
