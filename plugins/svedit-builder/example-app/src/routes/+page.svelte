<script lang="ts">
  import Canvas from '$lib/svaro/Canvas.svelte';
  import ComponentList from '$lib/svaro/ComponentList.svelte';
  import PropertyEditor from '$lib/svaro/PropertyEditor.svelte';
  import Svaro from '$lib/svaro/Svaro.svelte';

  import Hero from '$lib/builder-components/Hero.svelte';
  import SignupCard from '$lib/builder-components/SignupCard.svelte';

  const config = [
    {
      id: 'hero',
      name: 'Hero',
      render: Hero,
      fields: {
        eyebrow: { label: 'Eyebrow', type: 'text', defaultValue: 'New' },
        title: { label: 'Title', type: 'rich_text', defaultValue: 'Hello world' },
        description: {
          label: 'Description',
          type: 'rich_text',
          defaultValue: 'This is a hero block.'
        },
        bgColor: { label: 'Background color', type: 'color', defaultValue: '#f0f0f0' }
      }
    },
    {
      id: 'signup',
      name: 'Signup Card',
      render: SignupCard,
      fields: {
        title: { label: 'Title', type: 'text', defaultValue: 'Join the beta' },
        buttonText: { label: 'Button text', type: 'text', defaultValue: 'Create account' },
        bgColor: { label: 'Background color', type: 'color', defaultValue: '#fff6ee' }
      }
    }
  ];
</script>

<svelte:head>
  <title>Svedit Builder Example</title>
</svelte:head>

<Svaro {config}>
  <div class="layout">
    <ComponentList />
    <Canvas />
    <PropertyEditor />
  </div>
</Svaro>

<style>
  :global(body) {
    margin: 0;
    background: linear-gradient(180deg, #f4efe7 0%, #e8dfd3 100%);
    color: #1f1a17;
    font-family: Georgia, "Times New Roman", serif;
  }

  .layout {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr) 320px;
    gap: 18px;
    padding: 18px;
  }
</style>
